# account-management — Security

This app administers **every tenant on the platform**. A compromise here is not
one customer's data, it is all of them plus the ability to provision and bill
new infrastructure. The controls below are sized for that, which is why several
of them are deliberately stricter than the QMS panel they were extracted from.

- [ARCHITECTURE.md](ARCHITECTURE.md) — how the pieces fit
- [SCHEMA.md](SCHEMA.md) — which columns hold secrets
- [DEPLOYMENT.md](DEPLOYMENT.md) — environment and secret placement
- [SECURITY_AUDIT_2026-08-29.md](SECURITY_AUDIT_2026-08-29.md) — the last full review: findings,
  what was verified sound, what is still open. This file says what the controls *are*; that one
  says how well they held.

---

## 1. The platform gate

```ts
user.role === 'admin' && user.email.toLowerCase().endsWith(`@${PLATFORM_EMAIL_DOMAIN}`)
```

Identical to the QMS `require_orcanos_admin`. Three properties, all of which
must survive any change:

1. **API routes answer 404, not 403.** `requirePlatformStaff()` returns
   `{detail: 'Not found'}` with status 404 so a non-staff caller cannot tell the
   routes exist. Turning these into 403s is an information leak, not a usability
   improvement.
2. **`role` and `email` come from the database on every request**, never from
   the JWT claims. The token is only a pointer (`sub`). Revoking an admin takes
   effect immediately rather than at token expiry.
3. **The page-level check is not the boundary.** `accounts/page.tsx` redirects
   for UX; the route handlers are what actually protect the data. Every new
   route handler starts with `requirePlatformStaff()`.

Pre-login routes are the deliberate exceptions: `/api/auth/config` (returns only
public `client_id`s) and the three sign-in routes.

## 2. Sessions

HS256 JWT, 24h expiry, claims `sub` / `email` / `name` / `account` /
`auth_method` / `iss: "orcanos-qms"` — byte-identical in format to the token the
QMS backend issues, so with a shared `JWT_SECRET` a session from either app is
accepted by the other.

Storage differs on purpose:

| | QMS | this app |
|---|---|---|
| Where | `localStorage` | `session_token` cookie |
| Flags | — | `httpOnly`, `sameSite: 'lax'`, `path: '/'`, `secure` in production |

`httpOnly` means an XSS bug in this console cannot exfiltrate a credential that
administers every tenant. That is the whole reason for the difference.

`secure` is conditioned on `NODE_ENV === 'production'` so local HTTP development
works; it is always on when deployed.

## 3. Secrets

**At rest.** Five `*_encrypted` columns, AES-256-GCM, format
`base64(12-byte nonce ‖ ciphertext ‖ 16-byte GCM tag)`, no AAD. `lib/crypto.ts`
is wire-compatible with `backend/account_keys.py` in both directions.
`ENCRYPTION_KEY` must decode to exactly 32 bytes; `keyBytes()` throws with the
generating command if it does not.

**Never to the browser.** `GET /api/accounts/:id` returns an explicit column
allow-list containing zero `*_encrypted` columns, and `toJobView()` strips the
secret columns off a provisioning job before it is serialised. No ciphertext
reaches a client, so there is nothing to attack offline. Check any column you
add against both.

**In transit through a job.** The generated Postgres password and the fetched
`service_role` key both pass through `account_provisioning`, both encrypted, and
both nulled at `done` along with `payload`. Passwords typed into the create form
are encrypted before the job row is written — plaintext never rests in the table.

**Environment.** Every variable in `.env.example` is privileged and server-side.
**Nothing is `NEXT_PUBLIC_`**, and adding one for anything in that file would
publish it to every browser. `lib/env.ts` is the only place `process.env` is
read.

**Rotation.** `ENCRYPTION_KEY` and `JWT_SECRET` are shared with QMS and must
never be changed independently — a mismatched `ENCRYPTION_KEY` makes every
existing account secret undecryptable. The offline tool is
`backend/rotate_encryption_key.py` in the QMS repo; it must run **before** the
env var changes, and must cover both apps.

## 4. Module isolation

No file under `src/lib/` that touches `node:crypto` or a service key may be
imported by a `'use client'` component. Specifically never import
`lib/orcanos.ts`, `lib/crypto.ts`, `lib/supabase.ts`, `lib/session.ts` or
`lib/provisioning.ts` from a client component.

This already bit once: `normalizeOrcanosUrl` lives in its own dependency-free
`src/lib/orcanos-url.ts` precisely because both the forms and the server need it,
while `lib/orcanos.ts` reaches `decryptSecret`.

## 5. SSRF and credential pinning

`POST /api/orcanos/test-login` takes a URL from the client, which makes it an
SSRF surface. Two controls:

**`isSafeExternalUrl()`** (`lib/orcanos.ts`) rejects anything that is not a plain
public http/https URL:

- non-http(s) schemes
- `localhost`, `*.localhost`, `*.internal`, `metadata.google.internal`,
  `169.254.169.254`
- IPv4 literals in `0.0.0.0/8`, `10/8`, `127/8`, `172.16–31/12`, `192.168/16`,
  `169.254/16`, `100.64/10` (CGNAT), `192.0.0/24`, `198.18/15`, and multicast
- **IPv4-mapped IPv6 spellings of any of the above** — `new URL()` normalises
  `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]`, which the dotted-quad check alone
  never matched. `asIpv4()` resolves both forms before the range test.
- IPv6 `::1`, unique-local `fc00::/7`, link-local `fe80::/10`

The decimal, octal and short IPv4 forms (`2130706433`, `0177.0.0.1`, `127.1`)
need no handling — `new URL()` normalises them to dotted quads before the guard
sees them. Verified against a 21-case corpus; see
[SECURITY_AUDIT_2026-08-29.md §5](SECURITY_AUDIT_2026-08-29.md).

**URL pinning.** When the caller supplies no password, the route falls back to
the account's stored credential **and** pins the URL to that account's own saved
`orcanos_api_url`. A decrypted secret is therefore never sent to a
client-chosen host. Keep those two together — the fallback without the pin is
the vulnerability.

Note the two residual limits: `isSafeExternalUrl` inspects the hostname as
written, so it neither resolves DNS (a public name pointing at a private address
still passes) nor sees where a `3xx` later redirects — `fetch` follows redirects
by default. Egress filtering is the control for both, not this function.
`redirect: 'manual'` would close the second but would break any real Orcanos
endpoint that redirects, which is the worse trade on a staff-only path.

**Sign-in is a second URL surface, unpinned but host-restricted.**
`POST /api/auth/local/login` takes its Orcanos URL from the request body
(0.2.7), so the server-side tenant pin no longer applies to it. What replaces
the pin is `ORCANOS_LOGIN_HOST_ALLOWLIST`, **`orcanos.com` by default since
0.2.8** — the field stays free text and can reach any tenant, but not any host.
§9.2 has the full reasoning; the short version is that the allowlist is the only
reason `QW_Login`'s `Is_admin` still means anything on that route.

**The pin is only as good as the column.** `orcanos_api_url`, `vector_db_host`
and `orcanos_db_host` are all in the `PATCHABLE` list, so "the account's own
saved URL" is a value a platform admin can set one request earlier. The
credential-use events in §8.2 record which host a decrypted secret actually
reached, which makes that visible after the fact — but it is detection, not
prevention. Open finding A-2 in
[SECURITY_AUDIT_2026-08-29.md](SECURITY_AUDIT_2026-08-29.md).

## 6. TLS on outbound connections

Two places relax certificate verification, both deliberate, both worth knowing:

| Where | Setting | Why |
|---|---|---|
| `tickRunningSchema` (`pg`) | `ssl: { rejectUnauthorized: false }` | Connecting to `db.<ref>.supabase.co` moments after the project was created by our own authenticated Management API call. |
| `testOrcanosConnection` (`mssql`) | `encrypt: true, trustServerCertificate: true` | On-prem Orcanos SQL Servers commonly use self-signed certificates. Traffic is encrypted; the certificate is not validated. |

Neither carries a long-lived secret to an untrusted party, but both are
trust-on-first-use. Do not extend the pattern to new call sites without a reason.

### 6.1 HTTP response headers

`next.config.mjs` sends these on every route. They were absent until 2026-08-29,
which meant the console could be framed by any origin — and the destructive
actions here (Delete account, the module toggles) are one click each.

| Header | Value | Why |
|---|---|---|
| `Content-Security-Policy` | `frame-ancestors 'none'` | Clickjacking. Sent as CSP because that is the directive modern browsers honour. |
| `X-Frame-Options` | `DENY` | The same, for anything that does not read CSP. |
| `X-Content-Type-Options` | `nosniff` | |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | The console URL was travelling in `Referer` to Google Fonts on every page load. |
| `Permissions-Policy` | camera/mic/geolocation off | |
| `Strict-Transport-Security` | 2 years, `includeSubDomains` | |

**Deliberately not a full CSP.** A `script-src` directive needs a nonce
integration with Next's inline bootstrap script; adding one blind breaks the
app. That gap matters more than usual here, because the argument for the
httpOnly cookie in §2 is "an XSS bug cannot exfiltrate the token" — true of the
token, but an XSS bug would still act as the admin inside the page. A real CSP
is the second half of that defence and is still open.

## 7. Deliberate hardening beyond QMS

Each of these is a change made because a control plane warrants it, not an
oversight — do not "restore parity" by undoing them:

| Change | Reason |
|---|---|
| **OAuth does not auto-create users.** | QMS writes a `users` row for any identity completing OAuth, defaulting to `role='user'`. Harmless there; here it lets any holder of a Google account in the org appear in the platform's user table. Staff are added deliberately by an existing admin. |
| **The OAuth `state` check is a hard failure.** | QMS skipped it when no local state existed, for compatibility with its legacy Supabase path. There is no legacy path here, so skipping would only buy a CSRF hole. |
| **The legacy Supabase-Auth login path is not ported.** | A second accepted token format in a control plane widens the attack surface for no benefit. A staff member holding only a legacy token signs in again. |
| **Session in an httpOnly cookie.** | See §2. |
| **Errors are shown, not swallowed.** | The QMS list ignored load failures and discarded the delete warning about the tenant's Supabase project not being de-provisioned. A silently discarded warning costs real money here. |

Signup, forgot-password and reset-password are also not ported — they need the
outbound email service, which QMS owns. Password resets still go through QMS.

## 8. Audit trail

Both apps write to the same master-DB `security_audit_log`, so the trail is
continuous across the migration (ISO 27001:2022 A.8.15 / A.8.16). Events are
listed in [SCHEMA.md §5](SCHEMA.md#5-cost-and-audit).

Logging is best-effort and non-blocking by design — a failed audit write logs to
the server console and does not break the request it describes. That is the right
trade-off for availability, but it does mean the trail is not guaranteed
complete; it is evidence, not a control.

Failed and denied sign-ins are recorded with the attempted email and a reason
(`no_such_user`, `not_platform_staff`), which is what makes brute-force and
unauthorised-access attempts visible.

### 8.1 ⚠️ The trail begins 2026-08-29

`security_audit_log` **did not exist in master** until it was created on
2026-08-29 (confirmed absent, PGRST205, then applied via the Supabase Management
API). Every event either app produced before that date was written to a table
that was not there, and — because logging is non-blocking — discarded without an
error surfacing anywhere.

**None of it is recoverable.** An empty period before 2026-08-29 means *"nothing
was being recorded"*, not *"nothing happened"*. Say so explicitly in any evidence
pack; an auditor reading an empty log as a clean history is a worse outcome than
admitting the gap.

### 8.2 What is recorded

Grouped as the Audit log page groups them. The catalog lives in
[`src/lib/audit-events.ts`](src/lib/audit-events.ts) and covers QMS's event types
too, since both apps append to the one table.

| Group | Events | Written by |
|---|---|---|
| **Sign-in** | `login_succeeded` · `login_failed` · `login_denied` · `logout` | this app |
| **Accounts** | `account_created` · `account_updated` · `account_deleted` | both |
| **Modules & licences** | `account_module_changed` · `trace_account_created` · `trace_account_updated` · `trace_account_deleted` | this app |
| **Secrets & keys** | `account_credentials_tested` · `orcanos_login_tested` · `trace_ai_config_changed` · `trace_ai_key_tested` · `llm_key_set` · `llm_key_revealed` · `llm_key_deleted` · `auth_methods_updated` | both |
| **Provisioning** | `account_provisioning_started` · `account_provisioning_failed` | this app |
| **Users & access** | `user_deleted` · `repo_member_added` / `_updated` / `_removed` | QMS |

Two properties worth preserving:

- **Every credential *use* is recorded, not only every credential change.** The
  four `*_tested` events fire on routes that decrypt a stored secret and make a
  real call with it — the Orcanos test-login falling back to the saved password,
  the saved SQL Server / vector DB connection tests, and the traceability AI key
  test with a blank key field. That is what the page means by "key access". No
  key or password value is ever written to `detail`.
- **A failed test is a recorded event, not an absent one.** `success` carries the
  outcome, so a run of failures — which is what an expired, rotated or revoked
  credential looks like from outside — is visible. Logging only successes would
  hide exactly the case worth seeing.

`account_updated` additionally records which fields changed and which secrets
were rotated (`secrets_rotated`), so a credential change is attributable without
storing the credential.

### 8.3 What is deliberately NOT recorded

Reads. Opening an account, the billing modal, the traceability usage drill-down,
and **the audit page itself**. Every page load would append a row and the signal
would drown in its own noise.

This is a judgement call, not an oversight. If A.8.15 evidence is ever required
to include *who read the audit log*, that should be added deliberately — with a
rate limit or a session-scoped dedupe — rather than by dropping a
`logSecurityEvent` into the read routes.

### 8.4 Filtering, and why event types are validated not escaped

The Audit log page filters by **event group** rather than by typing an exact
event name — nobody remembers that revealing an LLM key is `llm_key_revealed`,
and the real question is almost always "show me the secret-related events".
Several groups can be on at once; they expand to their event types and go out as
one comma-separated `event_type` parameter, which the route turns into a single
PostgREST `in.(…)`.

Those values are interpolated into that filter, so they are **validated against
`/^[a-z][a-z0-9_]{0,63}$/`, not escaped**. Every event type the platform writes
is lower-case snake_case, which makes anything that could terminate the list or
append a filter impossible by construction. An entirely invalid selection is
treated as *no event-type filter* rather than as an error — for an audit view,
failing towards showing more is the safe direction.

An event type with no group renders as **uncatalogued** rather than blank, so a
new event type added elsewhere is visible in the UI instead of silently
ungroupable.

## 9. Known risks and open items

| Item | Status |
|---|---|
| **SQL Server reachability from Vercel.** A customer SQL Server firewalled to the Cloud Run egress IPs will refuse Vercel. | Open, infrastructure. Confirm against a real customer account before retiring the QMS panel. |
| **Delete does not de-provision the tenant's Supabase project.** Same as QMS; the difference is the warning is now shown. That project keeps costing money until someone removes it. | By design, mitigated by surfacing it. |
| **Orphaned provisioning jobs** leave billable projects. | Mitigated — durable and queryable, see [SCHEMA.md §3](SCHEMA.md#3-account_provisioning). Check after any failed run. |
| **`readServiceKey()` is lenient about response shape**, never verified against a live org. | Open. Tighten after the first real end-to-end run. |
| **`isSafeExternalUrl` does not resolve DNS.** | Accepted; egress filtering is the control. |
| **A single `ENCRYPTION_KEY` protects every tenant secret.** No per-account key separation. | Inherited from QMS. Rotation tooling exists; per-tenant keys do not. |
| **The sign-in Orcanos URL is client-supplied** (0.2.7), so the tenant is not pinned server-side. | **Mitigated in 0.2.8** — `ORCANOS_LOGIN_HOST_ALLOWLIST` defaults to `orcanos.com`, so only Orcanos hosts can be used for sign-in. See §9.2. Do not set it to `*`. |
| **Service-role key, not RLS.** All master-DB access uses the service key, so PostgREST row-level security is not a second line of defence — `requirePlatformStaff()` is the only one. | By design; it is why the gate discipline in §1 is non-negotiable. |

### 9.1 Open findings from the 2026-08-29 audit

Full detail, evidence and recommended fixes in
[SECURITY_AUDIT_2026-08-29.md](SECURITY_AUDIT_2026-08-29.md). Fixed on the day:
security headers (§6.1), the SSRF hostname gaps (§5), and a missing
`email_verified` check on Google sign-in. Still open:

| # | Finding | Severity | Blocked on |
|---|---|---|---|
| ~~A-1~~ | ~~Office 365 sign-in trusts an attacker-settable email.~~ **Closed 2026-08-29 — Microsoft sign-in withdrawn.** `office365SignInEnabled()` in `lib/env.ts` is `false`; the route refuses with 403 and audits the attempt, and `/api/auth/config` will not advertise the method. The code-level switch is the control, not the DB flag — hiding a button does not stop a direct POST. Do not re-enable without the three fixes listed in the audit. | — | Closed |
| A-2 | **Host columns are `PATCHABLE`**, so the credential pin in §5 can be aimed one request earlier. Detection exists (§8.2); prevention does not. | Medium | Host-check, secret-invalidation, or both |
| A-3 | **No rate limit or lockout on any auth route.** `POST /api/auth/local/login` is an unauthenticated guessing oracle against the Orcanos tenant. | Medium | Vercel Firewall vs in-code |
| A-9 | **Audit events carry no IP or user agent**, so A-3 has no working compensating control and A.8.15 evidence has no source attribution. | Low | Coordinating a column with QMS |
| A-7 | Pre-auth routes return raw PostgREST / provider error text. | Low | — |
| — | **No full CSP** (§6.1), and `fetch` still follows redirects past the SSRF guard (§5). | Low | — |

### 9.2 The sign-in Orcanos URL is client-supplied, host-restricted (B-1, 0.2.7–0.2.8)

**Status: mitigated.** The login screen has an *Orcanos URL* field, free text,
pre-filled with `ORCANOS_LOGIN_URL` (default `app.orcanos.com/orcanos`), and
`POST /api/auth/local/login` accepts `orcanosUrl` in the body and calls
`QW_Login` against it (0.2.7). **`ORCANOS_LOGIN_HOST_ALLOWLIST` then restricts
which hosts that may be — `orcanos.com` and its subdomains by default (0.2.8).**
Any tenant on an Orcanos host is reachable from the box; nothing else is.

The rest of this section is why that allowlist is load-bearing rather than
belt-and-braces. It describes what 0.2.7 shipped for one release with the
allowlist empty, and is exactly what returns if anyone sets it to `*`.

**Why the unrestricted form is critical.** Until 0.2.7 the tenant was pinned
server-side, and
[CLAUDE.md](CLAUDE.md) said in terms why: *"Requiring Orcanos `Is_admin` is safe
only because the tenant is pinned."* That is now gone, and the failure is worse
than the warning anticipated. The same request-supplied string decides **both**
which server is asked **and** which `Virtual_dir` that server is expected to
report, so the `identity.virtualDir !== expectedVirtualDir` check compares an
attacker's value against an attacker's value. Concretely:

1. Attacker stands up any host that answers `POST /<path>/api/v2/Json/QW_Login`
   with `{"IsSuccess": true, "Data": {"User_details": {"User_name": "…",
   "Is_admin": "1", "Virtual_dir": "orcanosdemo"}}}`.
2. Attacker POSTs to `/api/auth/local/login` with that URL, a staff member's
   email or `orcanos_user_name`, and **any password**.
3. Every Orcanos-side gate passes, because the Orcanos side is theirs.

They still need to name a master `users` row that has an `orcanos_user_name`, is
`role='admin'` and is `@orcanos.com` — but those are identifiers, not secrets,
and one of them is written down in this repo. **This is a pre-auth full account
takeover of the control plane, not a privilege-escalation edge case.** No
password is ever needed.

**The mitigation, and why it is enough.** `ORCANOS_LOGIN_HOST_ALLOWLIST`
defaults to `orcanos.com`; a host matches itself or any subdomain, so step 1
above requires the attacker to control an `*.orcanos.com` name. If they do,
this route is not the problem you have. Every real tenant
(`app.orcanos.com/…`, `us.orcanos.com/…`) keeps working untouched.

Three properties to preserve if you change any of it:

1. **The allowlist is checked only for a URL that arrived on the request.** A
   URL from `accounts.orcanos_api_url` or `ORCANOS_LOGIN_URL` is server-side
   already. That is also where an on-prem customer on their own domain belongs —
   configured, not typed at a login screen.
2. **Turning it off is spelled `*`, not "unset".** An empty or missing variable
   falls back to the default, so B-1 cannot return by someone clearing a value
   in a Vercel settings page and not noticing.
3. **`isSafeExternalUrl()` still runs underneath it** (no loopback, private
   ranges, metadata endpoints), `isPlatformStaff()` is still re-read from master
   on every request in `completeLogin()` so `role` remains the instant kill
   switch, and every login event records `orcanos_url`, `virtual_dir` and
   `client_supplied_url`.

**If you are re-reading this because something happened:** query
`security_audit_log` for `detail->>'client_supplied_url' = 'true'` and check
every distinct `detail->>'orcanos_url'` against the tenants you actually own.

## 10. Checklist for a new route handler

1. First line is `requirePlatformStaff()` — unless the route is deliberately
   pre-login, in which case say so in the file header.
2. Return the guard's `error` Response as-is. Do not convert it to a 403.
3. Select an explicit column list. Never `select=*` on `accounts`.
4. No `*_encrypted` column in anything returned to the browser.
5. Encrypt only non-empty values on write, so a blank field keeps the stored
   secret.
6. Log a `security_audit_log` event for anything that changes state — **and for
   anything that decrypts or uses a stored secret, even when it changes
   nothing** (§8.2). Pass `success` so a failure is recorded rather than absent.
   Add the event type to `lib/audit-events.ts` so it gets a filter group.
7. `export const runtime = 'nodejs'` if it touches `node:crypto`, `pg` or `mssql`.
