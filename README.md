# account-management

The Orcanos platform control plane. Manages tenant **accounts** — their
databases, credentials, status and spend — and the platform's security audit
trail.

Extracted from the Accounts panel inside **Orcanos QMS AI**
(`zoharp/orcanos_qms_AI`), where it was a modal in the chat sidebar visible only
to `@orcanos.com` administrators. It is the intended home for the rest of the
platform's management surface — cost, users, AI setup — as those move across.

- **Stack:** Next.js 15 (App Router, TypeScript) · React 19 · plain CSS
- **Hosting:** Vercel. Everything runs on Vercel — there is no Cloud Run
  dependency and no separate backend.
- **Database:** the existing **master / platform Supabase** — the same one the
  QMS backend calls `SUPABASE_URL`. This app creates no database of its own.

---

## How it relates to Orcanos QMS

The two apps share three things and must keep sharing them:

| Shared | Why it matters |
|---|---|
| `JWT_SECRET` | Session tokens are the same HS256 JWT with the same claims. A token issued by either app is accepted by the other. |
| `ENCRYPTION_KEY` | Account secrets are AES-256-GCM with a 12-byte nonce prefix. Both apps read and write the same five `*_encrypted` columns. A mismatch makes existing secrets undecryptable. |
| The master Supabase | `accounts`, `users`, `auth_methods`, `account_usage_logs`, `security_audit_log`, `account_llm_keys`. |

**The QMS Accounts panel is still live.** Nothing was removed from QMS — this
app was built alongside it so the two can be compared against the same data
before the old panel is retired. See *Retiring the QMS panel* below.

---

## Setup

### 1. Environment

Copy `.env.example` to `.env.local` and fill it in. The first four values must
be copied **verbatim** from the QMS backend's `.env`:

```
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
JWT_SECRET=
ENCRYPTION_KEY=
```

Then the provisioning credentials and the gate:

```
SUPABASE_ORG_ACCESS_TOKEN=    # Supabase Dashboard > Account > Access Tokens
SUPABASE_ORG_ID=
PLATFORM_EMAIL_DOMAIN=orcanos.com
PLATFORM_ACCOUNT=orcanos
```

Every variable is server-side. Nothing is `NEXT_PUBLIC_`, and nothing here may
ever be imported into a client component.

### 2. Database migrations

Run once against the **master** Supabase, in the SQL editor. ⚠️ **As of 2026-08-28
neither has been applied**, and the app is partly broken until they are:

```
Orcanos QMS/design/sql/009_security_audit_log.sql    → creates security_audit_log
sql/001_account_provisioning.sql                     → creates account_provisioning
```

| Missing | Symptom |
|---|---|
| `security_audit_log` | Audit log page returns **HTTP 500**; every audit write is silently discarded |
| `account_provisioning` | **Create account** fails |

Both are `create table if not exists` plus indexes — purely additive, nothing the
QMS reads or writes is touched, so applying them cannot affect the running QMS.
Neither can be applied through PostgREST; use the SQL editor or the Management API.

### 3. Run

Double-click **`run_dev.bat`** — it frees port 3100, creates `.env.local` from
the example and opens it if it is missing, installs dependencies on first run,
starts the dev server and opens the browser.

Or by hand:

```bash
npm install
npm run dev          # http://localhost:3100
```

### Scripts

| File | What it does |
|---|---|
| `run_dev.bat` | **Main dev launcher** — frees port 3100, checks `.env.local`, installs deps if missing, runs `npm run dev` on http://localhost:3100 |
| `deploy.bat` | **Deploy** — typecheck → production build → commit → push. Refuses to push unless the build passes, and requires typing `DEPLOY` to confirm, because a push to `main` is a production deploy |

### 4. OAuth redirect URI

Sign-in reuses the platform account's existing Google / Microsoft OAuth app —
the `client_id` and secret come from its `auth_methods` row, same as QMS. Only
the redirect URI differs, so **add this app's callback to the OAuth client**:

```
http://localhost:3100/auth/callback          (development)
https://<your-vercel-domain>/auth/callback   (production)
```

Google: APIs & Services → Credentials → the OAuth client → Authorised redirect
URIs. Microsoft: App registrations → Authentication → Redirect URIs.

A missing entry gives `Error 400: redirect_uri_mismatch` and no other diagnostic.
Changes take a few minutes to propagate — wait before assuming something else is
wrong.

⚠️ Register on the client belonging to **`PLATFORM_ACCOUNT`**. That is currently
`orcanosdemo` (renamed from `demo` on 2026-08-29), not `orcanos`, so the login
screen serves that account's OAuth clients — settle which account this console
should authenticate against before registering production URIs. See
[TESTING.md](TESTING.md).

The authorize call deliberately sends **no `access_type` and no `prompt`**. The
code is exchanged once for the profile and the refresh token is never used, so
`access_type=offline` only forced Google's consent screen on every sign-in.
Don't reintroduce either parameter.

---

## Deploying to Vercel

1. Import `zoharp/account-management` as a new Vercel project. Framework preset
   Next.js; no build overrides needed.
2. Set every variable from `.env.example` in Project Settings → Environment
   Variables, for Production **and** Preview.
3. Add the production `/auth/callback` URL to the OAuth client (step 4 above).
4. Deploy.

Pushing to `main` deploys to production, the same as the other projects in this
portfolio — **treat a push as a deploy** and do not push without approval.

---

## What it does

| Screen | What it covers |
|---|---|
| **Accounts** | Every tenant: name, DB type, active/inactive toggle, lifetime cost and tokens, created date. Search, edit, delete. |
| **Account detail** | Orcanos SQL Server host/db/user/password, Orcanos REST API URL + credentials, vector DB type/host/key. Connection tests for all three. LLM key status. |
| **Billing** | Per-account usage log drill-down with token and cost totals. |
| **Create account** | Provisions a dedicated Supabase project, waits for it, runs the bootstrap schema, saves the account row — with a live progress log. |
| **Audit log** | The shared `security_audit_log` trail: logins, account changes, key access. |

### The platform gate

Access requires an email in `PLATFORM_EMAIL_DOMAIN` **and** `role = 'admin'` in
the master `users` table — the same predicate as the QMS
`require_orcanos_admin`. API routes answer **404**, not 403, so a non-staff
caller cannot tell the routes exist. Keep it that way.

---

## Known deltas from the QMS implementation

Each of these is a deliberate change, not an oversight.

**Provisioning is a resumable job, not one long stream.** QMS creates the
Supabase project inside a single streaming request that can run for minutes. On
Vercel that request can hit the function duration limit part-way through,
leaving a real, billable Supabase project with no `accounts` row pointing at it
and no record that it was ever requested. Here each step is persisted in
`account_provisioning` and the client polls; a timeout, redeploy or closed
browser costs one poll, not the job. Orphans are findable — the query is at the
bottom of `sql/001_account_provisioning.sql`.

**SQL Server is reached with `mssql` (tedious), not `pyodbc`.** There is no ODBC
driver on Vercel. Results are equivalent and error text differs. ⚠️ **Network
reachability may differ**: a customer SQL Server firewalled to the Cloud Run
egress IPs will refuse connections from Vercel. Confirm this per account before
retiring the QMS panel — it is an infrastructure question, not a code one.

**The session token lives in an httpOnly cookie, not `localStorage`.** Same
token, different storage. A console that administers every tenant should not
hold its credential somewhere JavaScript can read.

**OAuth does not auto-create users.** QMS writes a `users` row for any identity
that completes OAuth, defaulting to `role='user'`. Harmless there; not something
a control plane should permit. An identity with no existing row is refused —
staff are added deliberately by an existing admin.

**The legacy Supabase-Auth login path is not ported.** Staff sign in through
`auth_methods`. Carrying a second accepted token format into a control plane
widens the attack surface for no benefit.

**Signup, forgot-password and reset-password are not ported.** They need the
outbound email service, which QMS owns. Password resets still go through QMS.

**Errors are shown, not swallowed.** The QMS list ignored load failures
("user may not be orcanos admin") and discarded the delete warning about the
tenant's Supabase project not being de-provisioned. Both surface here — the
second one costs real money when it goes unnoticed.

**`GET /admin/accounts/{id}/usage-logs` totals were always page totals**, not
lifetime totals. That is unchanged, but the billing modal now says so; the
lifetime figure is the one in the list column, from `account_cost_totals()`.

---

## Endpoint map

| This app | QMS equivalent |
|---|---|
| `GET /api/accounts` | `GET /admin/accounts` |
| `POST /api/accounts` | `POST /admin/accounts` (streaming → job) |
| `POST /api/accounts/provision/:jobId` | *(new — drives the job)* |
| `GET/PATCH/DELETE /api/accounts/:id` | `GET/PATCH/DELETE /admin/accounts/{id}` |
| `GET /api/accounts/:id/usage-logs` | `GET /admin/accounts/{id}/usage-logs` |
| `POST /api/accounts/:id/test-connections` | `POST /admin/accounts/{id}/test-connections` |
| `POST /api/accounts/test-connection` | `POST /admin/accounts/test-connection` |
| `POST /api/orcanos/test-login` | `POST /orcanos/proxy/login` (narrowed) |
| `GET /api/audit-log` | `GET /admin/audit-log` |
| `GET /api/auth/config` | `GET /auth/config` |
| `POST /api/auth/google` · `office365` · `local/login` | same paths under `/auth/` |

Not ported: `POST /admin/accounts/{id}/test-connection` (the legacy `db_*`
single test — superseded by `test-connections`), and the LLM-key and
auth-methods endpoints, which belong to the QMS per-tenant Admin panel rather
than to Accounts.

---

## Retiring the QMS panel

Do this only after the new app has been exercised against production data.

1. Verify against the same account in both apps: list totals match, detail loads,
   each connection test agrees, billing matches.
2. **Confirm SQL Server reachability from Vercel** for at least one real
   customer account (see *Known deltas*).
3. Create one real account end to end here.
4. Then, in the QMS repo: drop `onOpenAccounts` from `App.jsx`, the menu item in
   `ChatHistory.jsx:246-250`, and the four `Account*.jsx` components. Leave the
   backend endpoints in place until nothing calls them.

---

## Docs

| File | What it covers |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Architecture summary, the traps, conventions, what not to do. Start here when changing code. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | The design in depth — request lifecycle, module map, the provisioning state machine, and the reasoning behind each decision. |
| [SCHEMA.md](SCHEMA.md) | Every table and column this app touches, with DDL and who owns what. |
| [SECURITY.md](SECURITY.md) | The access gate, the encryption contract, SSRF protection, the audit trail, and the configuration mistakes that break things quietly. |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Vercel setup, environment variables, OAuth redirect URIs, verification, rollback. |
| [TESTING.md](TESTING.md) | The manual test plan — and an honest account of what has actually been verified. |
| [docs/platform/PLATFORM_AUTH.md](docs/platform/PLATFORM_AUTH.md) | Workspace-level: how authentication works across all five projects and where it is heading. |

SQL:

- `sql/001_account_provisioning.sql` — the one migration, with its rationale and
  the orphan-project query.
- `sql/bootstrap_new_account.sql` — the per-account schema applied to every newly
  provisioned tenant database. Copied from the QMS repo; this app now owns
  running it.

> ⚠️ **Status: partially verified (v0.1.1, 2026-08-28).** Google sign-in works
> against the live master database. The audit log returns 500 and account
> creation will fail — both because their tables were never created (see
> *Setup → 2*). Everything past the login screen is still unexercised. Work
> through [TESTING.md](TESTING.md), starting with the encryption-key check,
> which must pass before you save anything.
