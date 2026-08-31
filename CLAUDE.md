# account-management — Notes for Claude Code

Read this before changing anything here. **This file is the source of truth** for
how to work in this repo; the other docs go deeper on one topic each.

### Current versions (update after every bump)
- **App:** `0.3.2`

Release history is **not** kept in this file — it is
[`docs/changelog/CHANGELOG-v0.md`](docs/changelog/CHANGELOG-v0.md) (long form) and
[`release_notes.json`](release_notes.json) (the short list the app's own release-notes modal
shows, reachable from the version in the sidebar footer). CLAUDE.md is loaded into every session
and capped at 150,000 chars, so it carries the current version and the traps — nothing historical.

**After every shippable change:** bump `package.json` and the block above, prepend an entry to
`release_notes.json`, prepend the long form to the changelog, and add its row to
[`docs/changelog/README.md`](docs/changelog/README.md). Never put customer data or account names
in `release_notes.json` — it ships to the browser verbatim.

### Docs map

| File | What it is | Read it when |
|---|---|---|
| `CLAUDE.md` | **This file** — architecture summary, the traps, conventions, what not to do | Always, first |
| [`README.md`](README.md) | Human-facing: what it is, setup, scripts, known deltas from QMS | Setting it up |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | The design in depth — request lifecycle, module map, the provisioning state machine, why each decision | Changing how something works |
| [`SCHEMA.md`](SCHEMA.md) | Every table and column touched, with DDL and ownership | Touching the database |
| [`SECURITY.md`](SECURITY.md) | The gate, encryption contract, SSRF, response headers, audit trail, config risks | Touching auth, secrets or an outbound call |
| [`SECURITY_AUDIT_2026-08-29.md`](SECURITY_AUDIT_2026-08-29.md) | The last full security review — findings with evidence, what was verified sound, what is still open | Before shipping auth or secret-handling work; when asked what the security posture is |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Vercel setup, env vars, OAuth redirect URIs, rollback, retiring the QMS panel | Deploying |
| [`TESTING.md`](TESTING.md) | The manual test plan, and what has genuinely been verified | Before and after any change |
| [`INTERNAL_TRACE_MERGE.md`](INTERNAL_TRACE_MERGE.md) | **Internal.** The traceability-matrix merge — decisions taken, what is built, every known gap and risk | Touching the merged list, `lib/trace.ts`, `lib/modules.ts` or `api/accounts/trace/*` |
| [`docs/platform/`](docs/platform/README.md) | **Platform-wide, wider than this app.** [`PLATFORM_AUTH.md`](docs/platform/PLATFORM_AUTH.md) — how auth works across all five projects and where it is going; [`PLATFORM_MODULES_PROPOSAL.md`](docs/platform/PLATFORM_MODULES_PROPOSAL.md) — the module portal and per-module licensing; [`SOURCE_PROJECTS.md`](docs/platform/SOURCE_PROJECTS.md) — what the four source projects are | `PLATFORM_AUTH.md` before touching `lib/session.ts`, `lib/login.ts` or `api/auth/*`; the others for consolidation questions |

---

## Current state — read this before anything else

The app runs against the live master Supabase (`jjiavhexvfahboiodomv`) at
**https://accounts.orcanos.ai**. **Both sign-in methods and the accounts list are now verified;
everything that writes is not.** Full record in [TESTING.md](TESTING.md).

| | |
|---|---|
| ✅ Verified | Dev server on :3100, `GET /api/auth/config`, **Google sign-in** |
| ✅ **Verified 2026-08-30 — Orcanos sign-in, end to end at last.** `login_succeeded` at `01:43:32Z`, `method: "orcanos"`, for `zoharp@orcanos.com`. The whole gate ran: `QW_Login`, `Is_admin`, the tenant check, `linkOrcanosAccount()` (that row's `orcanos_account` is now `orcanos`) and `completeLogin()`. Two things had to be fixed first — see *Why it had never worked* below. |
| ✅ Verified 2026-08-30 | **Module licences against the live traceability instance** — `TRACE_API_URL` now points at Fly, not localhost. |
| ✅ Applied 2026-08-29 | **All three migrations are now in master**, via the Supabase Management API (`database/query`) rather than the SQL editor — same effect: `sql/002_orcanos_identity.sql`, `Orcanos QMS/design/sql/009_security_audit_log.sql`, `sql/001_account_provisioning.sql` |
| ⬜ Untested | **Audit log.** The table now exists and `GET` answers 200 — but it starts **empty**, and nothing retroactive is recoverable. No event either app produced before 2026-08-29 was ever recorded. |
| ⬜ Untested | **Create account.** `account_provisioning` now exists; the provisioning job has still never run end to end. Read the provisioning section below before the first real run. |
| ⬜ Untested | Account detail, connection tests, billing, sign-out. The **accounts list** now renders live, with module licences from Fly. |

### Why Orcanos sign-in had never worked (2026-08-30)

Both causes returned the same `Invalid credentials`, which is deliberate — every failure path in
`api/auth/local/login` answers identically so the route cannot be used to enumerate users. **The
real reason only ever reaches `security_audit_log`.** When someone reports a login problem, read
that table first; the screen cannot tell you anything.

1. **The identity was someone else's.** `users.id=1` (`zoharp@orcanos.com`) carried
   `orcanos_user_name='rami.azulay'` — test data this file had warned about since 0.2.0. The route
   calls `QW_Login` with the **stored** username, never with what was typed, so every password was
   being checked as Rami's and Orcanos rejected it (`reason: orcanos_rejected`,
   `"Incorrect credentials. Try Using SSO"`). Now `zohar.peretz`.
2. **The tenant was pinned to the wrong one.** `PLATFORM_ACCOUNT` is `orcanosdemo`, but this person
   is an Orcanos admin in tenant **`orcanos`**. Under the pre-0.2.7 design the login would have been
   refused as `wrong_orcanos_tenant` no matter how correct the password was. The successful event
   records `client_supplied_url: true` and `virtual_dir: "orcanos"` — i.e. **the free-text URL box
   added in 0.2.7 is what made this sign-in possible at all**, and the host allowlist added in
   0.2.8 is what keeps that safe. Worth knowing before anyone proposes re-pinning the tenant.

**No migrations are outstanding.** All three were applied on 2026-08-29. None can go through
PostgREST, so the route used was the Management API:

```
POST https://api.supabase.com/v1/projects/jjiavhexvfahboiodomv/database/query
Authorization: Bearer $SUPABASE_ORG_ACCESS_TOKEN     body: {"query": "<the .sql file>"}
```

All three are `create table if not exists` / `add column if not exists`, so re-running one is a
no-op. Use the same route for the next one rather than hand-editing in the SQL editor — it leaves
the file as the single source of what was run.

**`lib/audit.ts` already checks `res.ok`** (contrary to an earlier note in this file) — a non-2xx
audit write logs to the server console instead of being silently discarded. Still non-blocking by
design.

**Settled 2026-08-29 — accounts were renamed to match their Orcanos tenant, and `PLATFORM_ACCOUNT`
is now `orcanosdemo`.** The two master accounts whose `account_name` differed from the tenant
segment in their own `orcanos_api_url` were renamed to match it, so label and tenant are now one
string:

| id | was | now | tenant segment |
|---|---|---|---|
| `8ecbef88-c056-47da-86a7-ed61ce19213e` | `demo` | **`orcanosdemo`** | `orcanosdemo` |
| `fdd0c266-5829-45d6-8ef4-023bb6339c02` | `Medical Portal` | **`orca60`** | `orca60` |
| `818222f0-7ab2-484f-bdc7-8323eba9a380` | `Orcanos` | *(unchanged)* | `orcanos` |

⚠️ **This was done against the explicit written advice in
[INTERNAL_TRACE_MERGE.md §6.1](INTERNAL_TRACE_MERGE.md#61-account_name-was-renamed-to-the-tenant-2026-08-29),
at the user's request.** Read that section before assuming anything about QMS AI still works: in QMS
`account_name` is a routing key carried in the `X-Account` header from the browser's `localStorage`
and in `?account=` on shared links, and neither followed the rename. The `account_llm_keys`
orphaning that section warns about *was* prevented — see below.

`PLATFORM_ACCOUNT` in `.env.local` moved to `orcanosdemo` with it. **Set the same value in Vercel
before deploying**; with the old value `GET /api/auth/config` answers 404 and the login screen
offers no sign-in method at all. The login screen still renders the *orcanosdemo* account's OAuth
clients — that is the client the `/auth/callback` URI must be registered on. The staff gate is
unaffected (`PLATFORM_EMAIL_DOMAIN` is a separate variable).

**Renaming an account is a multi-table write.** `account_name` is a text key with **no foreign key**
in `auth_methods`, `account_llm_keys`, `account_usage_logs`, `account_provisioning` and
`security_audit_log`. The rename above updated the first three in one transaction through the
Management API `database/query` route (`account_provisioning` had no rows):

```sql
begin;
update auth_methods       set account_name='orcanosdemo' where account_name='demo';
update account_llm_keys   set account_name='orcanosdemo' where account_name='demo';
update account_usage_logs set account_name='orcanosdemo' where account_name='demo';
update accounts set account_name='orcanosdemo', updated_at=now() where id='8ecbef88-…';
-- and the same four for 'Medical Portal' → 'orca60'
commit;
```

`security_audit_log` was deliberately **not** rewritten. Its rows record the label an event actually
carried at the time; the seven historical `demo` rows stay `demo`. Expect the audit page's account
filter to show both spellings.

**Built — Orcanos-backed sign-in.** `POST /api/auth/local/login` verifies the password via
`QW_Login` instead of bcrypt-in-master. Blocked on `sql/002_orcanos_identity.sql` above until that
runs. Full record in *Orcanos sign-in* below and [`docs/platform/PLATFORM_AUTH.md`](docs/platform/PLATFORM_AUTH.md) §5.

---

## What this is

The Orcanos platform control plane, on Vercel. It manages tenant **accounts** —
databases, credentials, status, spend — plus the shared security audit trail.

It was extracted from the Accounts panel inside **Orcanos QMS AI**
(`c:\AI Projects\Orcanos QMS`, repo `zoharp/orcanos_qms_AI`), where it lived as
a modal in the chat sidebar gated to `@orcanos.com` admins. That panel is still
running. This app was built alongside it, not in place of it, so both can be
compared against the same production data before the old one is retired.

**The plan is that this app absorbs the rest of the platform's management
surface** — cost, users, AI setup — from QMS over time. Structure new work with
that in mind: a new area is a nav item in `AppShell` and a folder under
`src/app/`, not another modal bolted onto Accounts.

---

## The three things shared with QMS — do not break them

| Shared | Consequence of a mismatch |
|---|---|
| `JWT_SECRET` | Sessions stop interoperating. The token is the same HS256 JWT with the same claims (`sub`, `email`, `name`, `account`, `auth_method`, `iss: "orcanos-qms"`), so a token from either app works in the other. |
| `ENCRYPTION_KEY` | **Existing account secrets become undecryptable.** Five `*_encrypted` columns, AES-256-GCM, base64(12-byte nonce ‖ ciphertext ‖ 16-byte tag). `src/lib/crypto.ts` is wire-compatible with `backend/account_keys.py`. |
| The master Supabase | Both apps read and write the same `accounts`, `users`, `auth_methods`, `account_usage_logs`, `security_audit_log`, `account_llm_keys`. |

If you ever need to rotate `ENCRYPTION_KEY`, the QMS repo has the offline tool:
`backend/rotate_encryption_key.py`. It must run **before** the env var changes,
and it must cover both apps.

---

## Architecture

```
Browser ──▶ Next.js route handlers (Vercel, Node runtime)
                     │
                     ├──▶ master Supabase (PostgREST)   accounts, users, audit…
                     ├──▶ Supabase Management API        provisioning
                     ├──▶ db.<ref>.supabase.co:5432      bootstrap DDL (pg)
                     ├──▶ customer SQL Server            connection test (mssql)
                     └──▶ customer Orcanos REST          QW_Login test
```

No backend of our own beyond the route handlers; no Cloud Run. Every privileged
credential is server-side only — **nothing is `NEXT_PUBLIC_`**, and no file under
`src/lib/` that touches `node:crypto` or a service key may be imported by a
client component.

That last rule already bit once: `normalizeOrcanosUrl` lives in its own
dependency-free `src/lib/orcanos-url.ts` precisely because both the forms and
the server need it, while `src/lib/orcanos.ts` reaches `decryptSecret`.

### Scripts

| File | What it does |
|---|---|
| `run_dev.bat` | Frees port 3100, creates + opens `.env.local` if absent (and stops — the app cannot start without it), installs deps on first run, `npm run dev` in the foreground so Ctrl+C works |
| `deploy.bat` | typecheck → `next build` → commit → push. The build gate runs **before** the commit prompt, so a broken build never reaches a red Vercel deploy. Pushing requires typing `DEPLOY`. |

Same shape as the `run_dev.bat` / `deploy.bat` pair in the traceability-matrix
project. Don't add scripts for things `npm` already does — the `.bat` files
exist because the team is on Windows.

### File layout

```
src/
├── app/
│   ├── page.tsx                     ◀── redirect by session
│   ├── login/, auth/callback/       ◀── sign-in + OAuth landing
│   ├── accounts/, audit/            ◀── the two sections
│   └── api/
│       ├── auth/…                   ◀── config, google, office365, local/login, me, logout
│       ├── accounts/…               ◀── list, create, [id], usage-logs, test-connection(s)
│       ├── accounts/provision/[jobId]  ◀── drives a provisioning job
│       ├── audit-log/
│       └── orcanos/test-login/
├── components/                      ◀── all 'use client'
└── lib/
    ├── env.ts          ◀── every env read, with a message naming the variable
    ├── crypto.ts       ◀── AES-256-GCM, wire-compatible with the Python
    ├── session.ts      ◀── JWT + cookie + requirePlatformStaff
    ├── login.ts        ◀── the shared tail of every sign-in
    ├── supabase.ts     ◀── master-DB PostgREST helpers
    ├── users.ts        ◀── users / auth_methods lookups
    ├── connections.ts  ◀── SQL Server + vector DB tests
    ├── orcanos.ts      ◀── QW_Login test + SSRF guard  (server only)
    ├── orcanos-url.ts  ◀── URL normalisation           (client-safe)
    ├── provisioning.ts ◀── the resumable job state machine
    └── audit.ts        ◀── security_audit_log writes
```

---

## The platform gate

```ts
user.role === 'admin' && user.email.endsWith(`@${PLATFORM_EMAIL_DOMAIN}`)
```

Identical to the QMS `require_orcanos_admin`. Three properties to preserve:

1. **API routes answer 404, not 403.** A non-staff caller must not be able to
   tell these routes exist. `requirePlatformStaff()` does this; use it in every
   new route handler.
2. **`role` and `email` come from the database on every request**, never from
   the JWT claims. Revoking an admin takes effect immediately, not at token
   expiry.
3. **The page-level check is not the boundary.** `accounts/page.tsx` redirects
   for UX; the route handlers are what actually protect the data.

### Orcanos sign-in (built 2026-08-28)

Email/password sign-in (`POST /api/auth/local/login`) verifies the password via
`QW_Login` rather than bcrypt against `users.password_hash`. Full specification
in [`docs/platform/PLATFORM_AUTH.md`](docs/platform/PLATFORM_AUTH.md) §5; the parts that matter here:

**The join key.** `QW_Login` returns no email — only `User_details.User_name`
(e.g. `"orca"`), which is unique per tenant, not globally. Two columns on
master `users` (`sql/002_orcanos_identity.sql`), unique on
`(orcanos_account, lower(orcanos_user_name))`:

```sql
alter table users
  add column orcanos_user_name text,
  add column orcanos_account   text;   -- QW_Login Virtual_dir / the account id
```

`orcanos_account` always holds one value today. **Kept anyway** — it carries
the tenant dimension, so going multi-tenant later is a data migration into a
`user_identities` table rather than a redesign. No synthetic email is invented.

**Person and credential are separate acts, resolved as two different columns:**

- **`orcanos_user_name`** is set by an admin, the same deliberate way the row's
  `email` is — there is no self-service or UI for this yet, so it is set
  directly in the Supabase SQL editor. The route refuses to even attempt
  `QW_Login` for a `users` row that has none (logged as `no_such_user`, same
  message as a missing row — no enumeration). Since 0.2.6 the sign-in form's
  first field may hold **either** this username or the row's `email` — both are
  admin-set, and `QW_Login` is always called with the stored
  `orcanos_user_name`, never with the string that was typed.
- **`orcanos_account`** is filled automatically, once, the first time that row's
  `QW_Login` succeeds — `lib/users.ts` `linkOrcanosAccount()`. Every login after
  that compares the fresh `Virtual_dir` against the stored value and denies on
  a mismatch (`orcanos_identity_mismatch`). Before writing it, the route checks
  no *other* row already claims that `(orcanos_account, orcanos_user_name)` pair
  (`orcanos_identity_already_linked`) — belt-and-suspenders on top of the unique
  index, which is the real guard against a race.

**The gate, as implemented in `api/auth/local/login/route.ts`:**

```
QW_Login IsSuccess
  && Virtual_dir === <tenant segment of the sign-in URL>   ← ⚠️ NO LONGER PINNED (0.2.7)
  && Is_admin === '1'                   ← fails closed
  && orcanos_account (once set) matches Virtual_dir
  && completeLogin() → isPlatformStaff(): users.role === 'admin' && email domain ← re-read every request
```

⚠️ **Superseded by 0.2.7–0.2.8 — the tenant is no longer pinned to
`PLATFORM_ACCOUNT`; it comes from the sign-in URL, which the login screen lets
you type. What keeps the paragraph below true is `ORCANOS_LOGIN_HOST_ALLOWLIST`
(`orcanos.com` by default): the host is pinned even though the tenant is not.
Read [SECURITY.md §9.2](SECURITY.md), finding B-1, before touching either.**
Kept as written because it is the clearest statement of what is being protected.

⚠️ Requiring Orcanos `Is_admin` is safe **only because the tenant is pinned**
(`identity.virtualDir !== account` is checked before `Is_admin`, both against
the pinned `PLATFORM_ACCOUNT`, never a client-supplied value). If the Orcanos
URL a login checks against ever becomes client-supplied, any customer's own
Orcanos administrator walks into the control plane. Master `role` stays in the
conjunction because `Is_admin` is read once at login and the session lives
24 h — `role` is the only instant kill switch.

Keep `password_hash` and `local_enabled` in the schema; QMS still uses both,
and this app still reads `local_enabled` as the gate for whether the "sign in
with email" form appears at all — only what happens *inside* that route
changed.

**Not yet built:** an admin UI to set `orcanos_user_name`/`role` on a `users`
row. Today that is a manual `INSERT`/`UPDATE` in the Supabase SQL editor, same
as `auth_methods` and `PLATFORM_ACCOUNT` already are.

---

## Provisioning is a resumable job — this is the important design decision

`src/lib/provisioning.ts`. The QMS version is one generator streaming NDJSON
from a request that can run for minutes: create project → sleep-poll up to 300s
→ fetch keys → run DDL → insert the account row.

On Vercel that shape is unsafe. If the function hits its duration limit
mid-poll, a real and **billable** Supabase project exists with no `accounts` row
pointing at it and nothing recording that anyone asked for it.

So: `startProvisioning()` does only the fast part and persists a row in
`account_provisioning`; `tickProvisioning()` advances the job by exactly one
step; the client polls `POST /api/accounts/provision/:jobId` every 4s. A
timeout, redeploy or closed browser costs one tick, not the job.

States: `creating_project → waiting_healthy → fetching_keys → running_schema →
saving_account → done`, or `error`.

Things to keep:

- **Secrets on the job row are encrypted, and nulled at `done`.** The generated
  Postgres password and the fetched service_role key both pass through
  `account_provisioning`; neither ever rests in plaintext.
- **The service key is written to BOTH `db_password_encrypted` and
  `vector_db_password_encrypted`.** The legacy `db_*` pair is still read on some
  QMS paths. Populating only one leaves a tenant half-broken in ways that show
  up much later.
- **`readServiceKey()` is deliberately lenient about response shape.** The
  Supabase Management API field names were never verified against a live org —
  the Python carries the same caveat in its docstring. Verify against a real
  response the first time this runs end to end, and tighten it then.
- **Orphan projects are findable.** The query is at the bottom of
  `sql/001_account_provisioning.sql`. Check it after any failed run.

⚠️ **`running_schema` cannot work from Vercel, and never could (found 2026-08-31).**
The DDL step opens a direct `pg` connection to `db.<ref>.supabase.co`. That
hostname publishes **only an AAAA record** — Supabase dropped IPv4 for direct
connections — and Vercel functions are IPv4-only, so it fails with
`getaddrinfo ENOTFOUND`, which reads like a wrong hostname rather than a missing
address family. Confirmed by resolving it: AAAA answers, A does not, while
`aws-0-<region>.pooler.supabase.com` has A records.

This is why the very first real run left an orphan: the project
`klrgfaddrnnawvagomxr` (`qms-pcure`) was created and billable, then the job died
one step later. **Retrying makes it worse** — the second attempt fails at
creation with *"Project with name qms-pcure already exists"*, so you get an
orphan and no account.

The fix is to connect through the **pooler** (`aws-0-<region>.pooler.supabase.com:5432`,
user `postgres.<ref>`), which is IPv4-reachable. Not done — since 0.3.0 an
account can be created without a database at all, which removes this from the
common path. Anything still needing a provisioned project has to fix the host
first, and should also create the `accounts` row *before* the Supabase project
so a failure is recoverable.

`sql/bootstrap_new_account.sql` is a copy of the QMS file. **This app now owns
running it.** If the per-account schema changes, it changes here.

---

## Non-obvious behaviour worth preserving

1. **A blank password field means "keep the stored secret."** Only non-empty
   values are sent, and `PATCH /api/accounts/:id` only encrypts non-empty
   values. Sending an empty string would wipe a working credential.
2. **A new vector key cannot be saved until it has tested green.** The key is
   write-only from the UI's point of view, so a bad one is undetectable until
   the tenant's next query fails. Editing any vector field clears the cached
   test result — otherwise a green tick from the previous value would authorise
   saving a different one.
3. **`{success: null}` is a third state**, not a failure. It means "nothing
   configured to test" and renders neutral. Without it, every account with no
   Orcanos DB looks broken.
4. **`GET /api/accounts/:id` returns an explicit column allow-list containing
   zero `*_encrypted` columns.** No ciphertext reaches the browser, so there is
   nothing to attack offline. Check any column you add.
5. **`POST /api/orcanos/test-login` pins the URL when it falls back to a stored
   password.** If no password is typed, it uses the account's saved credential
   AND the account's own saved `orcanos_api_url` — a decrypted secret must never
   be sent to a client-chosen host. There is also an SSRF guard
   (`isSafeExternalUrl`) blocking loopback, private ranges and metadata
   endpoints.
6. **Route precedence.** `api/accounts/test-connection` and
   `api/accounts/provision` are static segments sitting beside the dynamic
   `api/accounts/[id]`. Next resolves static first, which is what makes them
   reachable. Don't rename them to something that looks like an id.
7. **The OAuth `state` check is a hard failure here.** QMS skipped it when no
   local state existed, for compatibility with its legacy Supabase path. There
   is no legacy path here, so skipping would only buy a CSRF hole.
8. **Delete does not de-provision the tenant's Supabase project.** Same as QMS.
   The difference is that the warning is now shown to the user instead of being
   discarded — that project keeps costing money until someone removes it.
9. **A Vercel environment change does nothing until something redeploys.**
   Vercel snapshots env vars into each deployment. Editing a variable and
   reloading the site shows the *old* value indefinitely, and a code push that
   happens to land afterwards picks up the new one — which makes it look like
   the code fixed it. Order is always: change the variable, **then** redeploy.
   Cost 2026-08-30: a deploy, then a second deploy, to change one string.
10. **`TRACE_ADMIN_PASSWORD` must equal the traceability instance's own
    `ADMIN_PASSWORD`.** They are two names for one shared secret, in two clouds
    (Vercel and Fly). Change one and the Traceability/Training columns go blank
    behind a banner. `TRACE_API_URL` and `TRACE_ADMIN_PASSWORD` must move
    **together** — pointing at Fly while keeping the local password turns
    "fetch failed" into a 401, which reads like a different bug.
11. **The Ask Paul pill is a licence, not a switch.** It writes
    `account_access.allow_ask_paul`, which is one of *three* ANDed gates; the
    other two — the user's Orcanos `O` letter, and the traceability
    deployment having `ASK_PAUL_SSO_SECRET`/`ASK_PAUL_APP_URL` set — are
    invisible from this console. Only the deployment gate fails closed, so the
    pill can read "licensed" while the button is hidden from everyone. Full
    table in traceability-matrix's `INTERNAL_ACCOUNT_ADMIN.md`.

    **Since 0.3.2 it cannot be turned ON without a database** (`vector_db_host`
    or `db_host`) — it is the only module with a per-tenant vector store, and
    licensing it without one is a hand-off into an app with nothing behind it.
    Enforced on all three surfaces *and* their routes (`POST /api/accounts`,
    `PUT /api/accounts/modules`, `PUT /api/accounts/trace/:tenant`), keyed on
    `ASK_PAUL_NEEDS_DB` / `askPaulDatabaseExists()` in `lib/modules.ts`.
    **Turning it OFF is never blocked** and the server checks only a transition
    to on — a pre-3.27.0 row has no `allow_ask_paul` column and reads as
    licensed, so blocking its save would lock the dialog for most tenants.
    Combined with `running_schema` being unusable from Vercel (see
    *Provisioning* above), Ask Paul currently **cannot be licensed at creation
    time**: create the account, add the DB under Edit → Vector DB, then use the
    pill.
12. **The login screen's failure message is deliberately useless.** Every path
    in `api/auth/local/login` returns `Invalid credentials` — missing row, no
    `orcanos_user_name`, wrong password, wrong tenant, not an Orcanos admin,
    identity already linked. The distinguishing `reason` goes only to
    `security_audit_log`. Diagnose from that table, never from the screen.

13. **`accounts` has five NOT NULL columns with no default**, four of which are
    the legacy `db_*` pair — `db_type`, `db_name`, `db_user`,
    `db_password_encrypted`. Nothing in this app's code hints at it, because
    until 0.3.0 every insert came from the provisioning job, which fills them
    from the project it just created. Omit one and PostgREST answers `23502`
    with the offending column name usually truncated out of the message. Full
    list and the query to re-check it in [SCHEMA.md §2](SCHEMA.md).
    **`tsc` and `next build` cannot catch this** — a database constraint is
    invisible to both. Verify a new insert shape by actually running it against
    the live table and deleting the row, not by building.

---

## Known deltas from QMS

Full list with reasoning in `README.md` → *Known deltas*. The one that is an
open operational risk rather than a decision:

⚠️ **SQL Server reachability.** Tests use `mssql`/tedious because Vercel has no
ODBC driver. A customer SQL Server firewalled to the Cloud Run egress IPs will
refuse Vercel. Confirm against a real customer account before retiring the QMS
panel.

---

## Conventions

- **Colours are tokens** in `src/app/globals.css` — Orcanos purple `#5C35A8`,
  orange `#F5A623`, sidebar `#EAE5F5`, Inter. No hex literals in components.
  The `ui-ux` skill is the reference.
- **`.acl-*` class names are kept from the QMS `AccountsList.css`** so the two
  implementations stay easy to diff while both exist. Once QMS's panel is gone,
  renaming them is fair game.
- **No UI library.** Plain CSS, as in every other project here.
- **Errors are shown.** The QMS panel swallowed load failures and discarded the
  delete warning. Don't reintroduce that.
- **Every new route handler starts with `requirePlatformStaff()`.**

---

## What NOT to do

- Don't add a `NEXT_PUBLIC_` variable for anything in `.env.example`. All of it
  is privileged.
- Don't import `lib/orcanos.ts`, `lib/crypto.ts`, `lib/supabase.ts`,
  `lib/session.ts` or `lib/provisioning.ts` from a `'use client'` component.
- Don't return a `*_encrypted` column to the browser.
- Don't change `JWT_SECRET` or `ENCRYPTION_KEY` independently of QMS.
- Don't turn the 404s in `requirePlatformStaff` into 403s.
- Don't restore the streaming create endpoint — read the provisioning section
  above first.
- Don't remove the QMS Accounts panel until the checklist in `README.md` →
  *Retiring the QMS panel* is done.
- Don't `git push` without being asked — a push to `main` deploys to production.

---

## Testing

The full plan is [TESTING.md](TESTING.md). Two things to internalise:

- **Only sign-in has run against the master database.** Google sign-in is
  verified, and since 2026-08-30 so is Orcanos sign-in and the accounts list.
  Nothing that **writes** — account detail, provisioning, billing — has been
  exercised. See *Current state* above.
- **The encryption-key check comes first.** Open an existing account and run
  *Test Orcanos DB* before saving anything. A wrong `ENCRYPTION_KEY` renders
  plausible screens and then corrupts credentials on the first save.

Short regression loop after a change:

1. `npx tsc --noEmit` and `npx next build`
2. Sign in and out
3. List loads with correct totals
4. Open an account; all three connection tests behave
5. Save a non-secret change
6. `GET /api/accounts` signed out → **404**
7. `/audit` shows the events from 2 and 5
