# account-management — Notes for Claude Code

Read this before changing anything here. **This file is the source of truth** for
how to work in this repo; the other docs go deeper on one topic each.

### Current versions (update after every bump)
- **App:** `0.2.5`

**0.2.5** (2026-08-29) — **Microsoft sign-in withdrawn.** Closes finding A-1: the route defaulted
`office365_tenant` to `common`, verified no `tid`, and took the identity from Graph's `mail` — an
attribute an attacker sets freely in a tenant they own, which made the `@orcanos.com` half of the
platform gate the attacker's own assertion. Off in three places, because hiding a button is not a
control: `office365SignInEnabled()` in `lib/env.ts`, a 403 + audited `login_denied` at the top of
`api/auth/office365`, and the method no longer advertised by `api/auth/config`. The DB flag
`auth_methods.office365_enabled` is now tidy-up, not the control. **Google and Orcanos email
sign-in are untouched** — each method resolves independently. The vulnerable code is left in place
and unreachable so re-enabling forces a read of the finding first.

**0.2.4** (2026-08-29) — **the Status column is gone; the Ask Paul pill writes both halves.**
`accounts.is_active` was never a platform gate — only QMS AI reads it, so an account set Inactive
could still sign in to traceability (found by doing it). It is one half of Ask Paul's switch:
`is_active` kills the app, trace `allow_ask_paul` only hides the hand-off button. One pill now
writes both and ANDs them for display, so every column is one control per module. The two systems
share no transaction, so master is written first and a failed trace write returns non-2xx naming
which half landed; the list reloads after a failure too. Full record in
[INTERNAL_TRACE_MERGE.md](INTERNAL_TRACE_MERGE.md) §4.4.

**0.2.3** (2026-08-29) — **security audit + hardening.** Full review of the whole tree, recorded in
[SECURITY_AUDIT_2026-08-29.md](SECURITY_AUDIT_2026-08-29.md). Three fixes applied: `isSafeExternalUrl`
now resolves IPv4-mapped IPv6 spellings (`[::ffff:127.0.0.1]` normalises to `[::ffff:7f00:1]` and
walked straight past the dotted-quad check) and blocks CGNAT `100.64/10`; `next.config.mjs` sends
security headers, chiefly `frame-ancestors 'none'` — the console was framable and Delete account is
one click; and Google sign-in now requires `email_verified`, which is load-bearing because the email
domain is half the platform gate. **Three findings are still open and two need a decision** — read
[SECURITY.md §9.1](SECURITY.md). The highest, A-1, is that Office 365 sign-in defaults to tenant
`common` and takes its identity from Graph's `mail`, an attribute an attacker sets in their own
tenant; whether it is live depends on `office365_enabled`, which nobody has checked.

**0.2.2** (2026-08-29) — the Orcanos mark now appears on the sidebar brand and the login card.
`src/components/OrcanosLogo.tsx` is the same inline SVG traceability-matrix uses
(`src/frontend/src/App.jsx`) — arc on `currentColor`, dot on a new `--logo-dot` token. That dot is
`#f5821f`, deliberately not `--accent-orange` `#f5a623`: it belongs to the mark, so it matches the
other app rather than the palette.

**0.2.1** (2026-08-29) — the **QMS AI** module pill is now **Ask Paul**, and reads/writes the real
licence column `account_access.allow_ask_paul` instead of being derived from master `is_active`.
Ask Paul *is* the QMS AI app (`ask_paul_account` holds a tenant's master `account_name`), so the
licence column already existed and no master DDL was needed. Status and Modules now answer
different questions — account gate vs per-product licence — instead of being one value rendered
twice with the same PATCH behind both. Full record in [INTERNAL_TRACE_MERGE.md](INTERNAL_TRACE_MERGE.md)
§4.3. Also: `package.json` said `0.1.1` while this file said `0.2.0`; both now say `0.2.1`.

**0.2.0** (2026-08-28) — Orcanos-backed sign-in built. `POST /api/auth/local/login` now verifies
the password via `QW_Login` against the platform account's own Orcanos tenant instead of bcrypt
against `users.password_hash`. New migration `sql/002_orcanos_identity.sql`, applied to master
2026-08-29. Also fixed: the tenant pin no longer compares `Virtual_dir` against `PLATFORM_ACCOUNT`
directly (that's just the master-DB config-row label, e.g. `demo` — confirmed live to differ from
the real tenant segment, `orcanosdemo`); it now compares against the tenant segment parsed out of
that account's own `orcanos_api_url` (`lib/orcanos-url.ts` `orcanosVirtualDirFromUrl()`). Not yet
confirmed with an actual successful sign-in — see *Current state* below.

**0.1.1** (2026-08-28) — first live run against the master database. Google sign-in fixed and
verified; two never-applied migrations found.

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
| [`../PLATFORM_AUTH.md`](../PLATFORM_AUTH.md) | **Workspace-level.** How auth works across all five projects, and where it is going | Before touching `lib/session.ts`, `lib/login.ts` or `api/auth/*` |

---

## Current state — read this before anything else

The app has now been run against the live master Supabase (`jjiavhexvfahboiodomv`).
**It is partially verified, not working end to end.** Full record in [TESTING.md](TESTING.md).

| | |
|---|---|
| ✅ Verified | Dev server on :3100, `GET /api/auth/config`, **Google sign-in** |
| ✅ Applied 2026-08-29 | **All three migrations are now in master**, via the Supabase Management API (`database/query`) rather than the SQL editor — same effect: `sql/002_orcanos_identity.sql`, `Orcanos QMS/design/sql/009_security_audit_log.sql`, `sql/001_account_provisioning.sql` |
| ⬜ Untested | **Audit log.** The table now exists and `GET` answers 200 — but it starts **empty**, and nothing retroactive is recoverable. No event either app produced before 2026-08-29 was ever recorded. |
| ⬜ Untested | **Create account.** `account_provisioning` now exists; the provisioning job has still never run end to end. Read the provisioning section below before the first real run. |
| ⬜ **Untested — Orcanos sign-in end to end.** `zoharp@orcanos.com` has `orcanos_user_name='rami.azulay'` set (test data, master DB). Nobody has yet completed a real `POST /api/auth/local/login` with a correct password and watched it succeed. Do this first before trusting the flow. |
| ⬜ Untested | Accounts list, account detail, connection tests, billing, sign-out |

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
runs. Full record in *Orcanos sign-in* below and [`../PLATFORM_AUTH.md`](../PLATFORM_AUTH.md) §5.

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
in [`../PLATFORM_AUTH.md`](../PLATFORM_AUTH.md) §5; the parts that matter here:

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
  message as a missing row — no enumeration).
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
  && Virtual_dir === PLATFORM_ACCOUNT   ← pinned server-side, NEVER client-supplied
  && Is_admin === '1'                   ← fails closed
  && orcanos_account (once set) matches Virtual_dir
  && completeLogin() → isPlatformStaff(): users.role === 'admin' && email domain ← re-read every request
```

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
  verified; everything past the login screen is not. See *Current state* above.
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
