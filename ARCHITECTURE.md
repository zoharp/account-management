# account-management — Architecture

How the app is put together and why. `README.md` is setup and operations;
`CLAUDE.md` is the conventions and the traps; this file is the structure.

- [SCHEMA.md](SCHEMA.md) — the database tables and who owns them
- [SECURITY.md](SECURITY.md) — the gate, secret handling, threat notes
- [DEPLOYMENT.md](DEPLOYMENT.md) — Vercel, environment, the deploy gate

---

## 1. Shape of the system

There is no backend service. The whole app is a Next.js 15 App Router
deployment on Vercel: React Server Components render the pages, route handlers
under `src/app/api/` do the privileged work, and everything privileged runs in
the Node runtime (`export const runtime = 'nodejs'`).

```
Browser (client components, no secrets)
   │  fetch /api/*  ·  session_token httpOnly cookie
   ▼
Next.js route handlers  (Vercel, Node runtime)
   │
   ├──▶ master Supabase, PostgREST      accounts, users, auth_methods,
   │                                    account_usage_logs, security_audit_log,
   │                                    account_llm_keys, account_provisioning
   ├──▶ Supabase Management API         api.supabase.com/v1  — provisioning
   ├──▶ db.<ref>.supabase.co:5432       bootstrap DDL, direct Postgres (pg)
   ├──▶ customer SQL Server             connection test (mssql/tedious)
   └──▶ customer Orcanos REST           QW_Login credential test
```

The master Supabase is the **same database** the Orcanos QMS backend calls
`SUPABASE_URL`. This app creates no database of its own and never touches a
tenant's vector database except during provisioning.

`next.config.mjs` marks `mssql`, `pg` and `bcryptjs` as
`serverExternalPackages` — they do dynamic requires, and tracing their optional
dependencies (tedious' MSAL paths, `pg-native`) breaks the bundle for code paths
that never run.

## 2. Layers

| Layer | Rule |
|---|---|
| `src/app/**/page.tsx` | Server components. Read the session, redirect, render a client component. The redirect is UX, **not** the security boundary. |
| `src/components/*` | All `'use client'`. Never import anything from `src/lib/` that reaches `node:crypto` or a service key. |
| `src/app/api/**/route.ts` | The actual boundary. Every handler starts with `requirePlatformStaff()` unless it is deliberately pre-login. |
| `src/lib/*` | Server-only, with one exception: `orcanos-url.ts` is dependency-free so both sides can use it. |

The client/server split already bit once. `normalizeOrcanosUrl` lives alone in
`src/lib/orcanos-url.ts` because the forms need it in the browser, while
`src/lib/orcanos.ts` reaches `decryptSecret` and can only run on the server.

## 3. Module map

| Module | Responsibility | Ported from (QMS) |
|---|---|---|
| `lib/env.ts` | Every `process.env` read, each failing with a message that names the variable. Read at call time, not module load, so a Vercel env change lands on the next cold start. | `backend/config.py` |
| `lib/crypto.ts` | AES-256-GCM, `base64(nonce ‖ ciphertext ‖ tag)`. Wire-compatible both directions. | `backend/account_keys.py` |
| `lib/session.ts` | HS256 JWT, httpOnly cookie, `requirePlatformStaff()`. | `backend/sessions.py`, `backend/auth.py` |
| `lib/login.ts` | The shared tail of every sign-in. Separate file because a `route.ts` may only export HTTP handlers. | — |
| `lib/supabase.ts` | `pgGet/pgPost/pgPatch/pgDelete/pgRpc` over PostgREST with plain `fetch`, plus `accountCiFilter()`. | `backend/api.py` request style, `account_ci_filter()` |
| `lib/users.ts` | `users` and `auth_methods` lookups. | `backend/auth.py` |
| `lib/connections.ts` | Vector DB and SQL Server connection tests. | `backend/connections.py` |
| `lib/orcanos.ts` | `QW_Login` — both the "Test API" credential check (`orcanosTestLogin`) and the sign-in identity check (`qwLoginIdentity`) — plus the SSRF guard. **Server only.** | `backend/api.py` |
| `lib/orcanos-url.ts` | URL normalisation. **Client-safe.** | `_normalize_orcanos_url` |
| `lib/provisioning.ts` | The resumable provisioning job. | `backend/provisioning.py` |
| `lib/audit.ts` | `security_audit_log` writes, best-effort. | `backend/audit_log.py` |
| `lib/types.ts` | Row shapes, tracking QMS `SCHEMA.md` §10/§18/§19. | — |

`lib/supabase.ts` deliberately uses plain `fetch` rather than
`@supabase/supabase-js`, mirroring the QMS backend's `requests` style so the two
implementations stay easy to diff while both exist.

## 4. Routes

Pages:

| Path | What it is |
|---|---|
| `/` | Redirects by session — `/accounts` or `/login`. |
| `/login` | Sign-in. Offers whatever `auth_methods` enables for `PLATFORM_ACCOUNT`. |
| `/auth/callback` | OAuth landing; exchanges the code, then redirects. |
| `/accounts` | The account list, detail modal, billing modal, create modal. |
| `/audit` | The shared security audit trail. |

API:

| Route | Methods | Gate | Audit events written |
|---|---|---|---|
| `/api/auth/config` | GET | public, pre-login | — |
| `/api/auth/google` · `office365` · `local/login` | POST | public, pre-login | `login_failed`, `login_denied`, `login_succeeded` |
| `/api/auth/me` | GET | session | — |
| `/api/auth/logout` | POST | session | `logout` |
| `/api/accounts` | GET, POST | staff | `account_provisioning_started` |
| `/api/accounts/provision/[jobId]` | GET, POST | staff | `account_created`, `account_provisioning_failed` |
| `/api/accounts/[id]` | GET, PATCH, DELETE | staff | `account_updated`, `account_deleted` |
| `/api/accounts/[id]/test-connections` | POST | staff | — |
| `/api/accounts/[id]/usage-logs` | GET | staff | — |
| `/api/accounts/test-connection` | POST | staff | — |
| `/api/orcanos/test-login` | POST | staff | — |

**Route precedence matters here.** `api/accounts/test-connection` and
`api/accounts/provision` are static segments sitting beside the dynamic
`api/accounts/[id]`. Next resolves static first, which is the only reason they
are reachable at all — do not rename either to something that could read as an
id.

## 5. Authentication flow

```
/login ──▶ GET /api/auth/config
              reads auth_methods for PLATFORM_ACCOUNT
              returns enabled methods + public client_id only
   │
   ├── local ──▶ POST /api/auth/local/login    QW_Login against user.orcanos_user_name
   │              1. findUserByEmail — must exist AND have orcanos_user_name set
   │              2. qwLoginIdentity(apiUrl, orcanos_user_name, password)
   │              3. identity.virtualDir === PLATFORM_ACCOUNT   ← pinned, never client-supplied
   │              4. identity.isAdmin === true
   │              5. user.orcanos_account matches (or is set, on first success)
   └── OAuth ──▶ provider authorize ──▶ /auth/callback
                    ──▶ POST /api/auth/{google|office365}
                        exchanges code (client secret from auth_methods)
   │
   ▼
completeLogin()   lib/login.ts
   1. findUserByEmail  — must already exist; no auto-provisioning
   2. isPlatformStaff  — role='admin' AND @PLATFORM_EMAIL_DOMAIN
   3. createSessionToken + setSessionCookie
   4. logSecurityEvent('login_succeeded')
```

`local`'s password check is Orcanos-backed (`lib/orcanos.ts` `qwLoginIdentity()`), not bcrypt —
see CLAUDE.md "Orcanos sign-in". `password_hash` stays in the `users` schema for QMS but this app
no longer reads it.

The token is the same HS256 JWT the QMS backend issues — claims `sub`, `email`,
`name`, `account`, `auth_method`, `iss: "orcanos-qms"`, 24h expiry — so with a
shared `JWT_SECRET` a session from either app is accepted by the other. Only the
storage differs: httpOnly `session_token` cookie here, `localStorage` in QMS.

`getCurrentUser()` treats the JWT as a pointer only. `role` and `email` are
re-read from the master `users` table on every request, so revoking an admin
takes effect immediately rather than at token expiry.

## 6. Provisioning — the one significant design change

This is the reason the app is not a straight port. See
[SCHEMA.md §3](SCHEMA.md#3-account_provisioning) for the table.

The QMS version is a generator streaming NDJSON from one request: create
project → sleep-poll up to 300s → fetch keys → run DDL → insert the account row.
On Cloud Run that is fine. On Vercel, a function that hits its duration limit
mid-poll leaves a **real, billable Supabase project** with no `accounts` row
pointing at it and nothing recording that anyone asked for it. For a control
plane that is the worst available failure.

So provisioning is a resumable job. `startProvisioning()` does only the fast
part and persists a row; `tickProvisioning()` advances the job by exactly one
step and returns; the client polls `POST /api/accounts/provision/:jobId` every
4s. A timeout, redeploy or closed browser costs one tick, not the job.

```
creating_project ─▶ waiting_healthy ─▶ fetching_keys ─▶ running_schema
                                                             │
                                                             ▼
                                         done ◀── saving_account
                    (any step may fall to `error`)
```

| State | One tick does | Notes |
|---|---|---|
| `creating_project` | — | Reaching this state in a tick means the start request died between the insert and the Management API call. Fails with a clear message. |
| `waiting_healthy` | `GET /v1/projects/{ref}`, check `status` | `ACTIVE_HEALTHY` advances; `INIT_FAILED`/`REMOVED`/`RESTORE_FAILED`/`PAUSE_FAILED` fail; anything else stays. A non-OK HTTP response is treated as transient and retried. Hard timeout 10 min from `created_at`. |
| `fetching_keys` | `GET /v1/projects/{ref}/api-keys` | `readServiceKey()` accepts both documented shapes and `api_key`/`apiKey`/`key`. |
| `running_schema` | Direct Postgres to `db.<ref>.supabase.co:5432`, runs `sql/bootstrap_new_account.sql` as one statement | PostgREST cannot execute DDL; this is the only direct Postgres connection in the app. |
| `saving_account` | Inserts the `accounts` row | Then nulls `db_password_encrypted`, `service_key_encrypted` and `payload`. |

Three things to preserve:

1. **Secrets on the job row are encrypted and cleared at `done`.** The generated
   Postgres password and the fetched `service_role` key both pass through
   `account_provisioning`; neither ever rests in plaintext.
2. **The service key is written to both `db_password_encrypted` and
   `vector_db_password_encrypted`.** The legacy `db_*` pair is still read on some
   QMS paths; populating only one leaves a tenant half-broken in a way that
   surfaces much later.
3. **`readServiceKey()` is deliberately lenient.** The Management API field
   names were never verified against a live org — the Python carries the same
   caveat. Verify against a real response the first time this runs end to end,
   and tighten it then.

Orphans are findable: the query is at the bottom of
`sql/001_account_provisioning.sql`. Check it after any failed run.

## 7. Connection testing

Three independent tests, all returning `ConnectionTestResult`:

| Test | Mechanism |
|---|---|
| Vector DB (`supabase`) | `GET {host}/rest/v1/` with the decrypted service key as `apikey`; HTTP ≥ 400 is a failure. 6s timeout. |
| Vector DB (Postgres) | `pg` client connect/disconnect against a composed connection string. 6s timeout. |
| Orcanos SQL Server | `mssql`/tedious `ConnectionPool`, `encrypt: true` with `trustServerCertificate: true`. Parses a stored ODBC `KEY=VALUE;` string when present, splitting `host,port`. 6s timeouts. |
| Orcanos REST | `POST {url}/QW_Login`, HTTP Basic, **no body at all** — not even `{}`. Counts projects for the "Connected — N projects found" message. |

`{success: null}` is a third state meaning "nothing configured to test", rendered
neutral. Without it, every account with no Orcanos DB looks broken.

`countProjects()` handles all three Orcanos array shapes — plain array,
`{Project: [...]}`, and a single bare object — because Orcanos wraps XML arrays.
The QMS backend learned this the hard way; see the `orcanos-api` skill.

⚠️ **`mssql` is not `pyodbc`.** Vercel has no ODBC driver, so this port uses a
pure-JS TDS driver. Results are equivalent and error wording differs, but
**network reachability may differ**: a customer SQL Server firewalled to the
Cloud Run egress IPs will refuse Vercel. That is an infrastructure question, not
a code one, and it must be confirmed per account before the QMS panel is retired.

## 8. Cost figures — two different numbers

Both come from the master DB's mirror, never from a tenant database:

- **List column** — `account_cost_totals()` RPC. Lifetime totals. If the RPC
  fails the list still renders, with zeros and a server-side log.
- **Billing modal** — `account_usage_logs` rows for one account. Its totals are
  **page** totals, not lifetime. That was always true in QMS; the difference is
  that the modal now says so.

## 9. Scripts

| File | What it does |
|---|---|
| `run_dev.bat` | Frees port 3100, creates and opens `.env.local` if absent (then stops — the app cannot start without it), installs deps on first run, `npm run dev` in the foreground so Ctrl+C works. |
| `deploy.bat` | typecheck → `next build` → commit → push. The build gate runs **before** the commit prompt, so a broken build never reaches a red Vercel deploy. Pushing requires typing `DEPLOY`. |

Same shape as the `run_dev.bat` / `deploy.bat` pair in traceability-matrix. Don't
add scripts for things `npm` already does — these exist because the team is on
Windows.
