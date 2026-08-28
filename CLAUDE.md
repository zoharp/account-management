# account-management — Notes for Claude Code

Read this before changing anything here. `README.md` is the setup and operations
guide; this file is the architecture and the traps.

### Current versions (update after every bump)
- **App:** `0.1.0`

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

## Testing this manually

1. `npm run dev` → http://localhost:3100
2. Sign in with an `@orcanos.com` admin. A non-admin, or a non-Orcanos address,
   must be refused at sign-in — not after.
3. Accounts list: totals and dates match what the QMS panel shows for the same
   accounts.
4. Toggle a status; reload; it stuck. Toggle back.
5. Open an account: every field matches QMS. Run all three connection tests and
   compare results with QMS for the same account.
6. Edit a non-secret field, save, reload. Then set a vector key without testing
   — Save must refuse.
7. Billing: figures agree with the QMS billing modal.
8. Create a test account end to end; watch the log; confirm the Supabase project
   exists, the schema applied, and the `accounts` row is correct. Then check
   `account_provisioning` has no orphan rows.
9. Audit log: the create and the edits from the steps above are all present.
10. Sign out → back to `/login`, and `/accounts` redirects there too.
