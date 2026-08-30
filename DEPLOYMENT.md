# account-management — Deployment

Everything runs on Vercel. There is no Cloud Run dependency, no separate backend
and no database of this app's own — see [ARCHITECTURE.md](ARCHITECTURE.md).

**A push to `main` is a production deploy.** Do not push without explicit
approval.

---

## 1. Environment

Ten variables, **all server-side**. Nothing is `NEXT_PUBLIC_`, and adding a
`NEXT_PUBLIC_` prefix to anything here publishes it to every browser.

| Variable | Required | Source | Notes |
|---|---|---|---|
| `SUPABASE_URL` | yes | QMS backend `.env` | Master/platform Supabase. |
| `SUPABASE_SERVICE_KEY` | yes | QMS backend `.env` | Service role key. |
| `JWT_SECRET` | yes | QMS backend `.env` | **Byte-identical to QMS** or sessions stop interoperating. |
| `ENCRYPTION_KEY` | yes | QMS backend `.env` | **Byte-identical to QMS** or existing account secrets become undecryptable. base64, must decode to 32 bytes. |
| `SUPABASE_ORG_ACCESS_TOKEN` | for provisioning | Supabase Dashboard → Account → Access Tokens | Org-wide project-creation rights. Treat as a top-tier secret. |
| `SUPABASE_ORG_ID` | for provisioning | Supabase dashboard | Not sensitive. |
| `SUPABASE_PROJECT_REGION` | no | — | Defaults to `us-east-1`. Region for newly provisioned tenant projects. |
| `PLATFORM_EMAIL_DOMAIN` | no | — | Defaults to `orcanos.com`. Half of the staff gate. |
| `PLATFORM_ACCOUNT` | no | — | Defaults to `orcanos`. The account whose `auth_methods` row drives the login screen — **this must name an account that actually has one.** |
| `ORCANOS_LOGIN_URL` | no | — | Defaults to `app.orcanos.com/orcanos`. Pre-fills the login screen's **Orcanos URL** box and is the fallback when neither the request nor the platform account's `orcanos_api_url` supplies one. Scheme and `/api/v2/Json` are added by `normalizeOrcanosUrl`. |
| `ORCANOS_LOGIN_HOST_ALLOWLIST` | **strongly recommended** | — | Empty by default, meaning **any host** the browser sends is accepted for sign-in. Set it to `orcanos.com` in production. Comma-separated; a host matches itself or any subdomain, so `app.` and `us.` both work. This is the whole control against [SECURITY.md §9.2](SECURITY.md) B-1 — without it, `QW_Login`'s `Is_admin` is an assertion by a server the caller picked. |
| `APP_ORIGIN` | no | — | Absolute origin, used to build the OAuth `redirect_uri`. Leave unset on Vercel; it derives from `VERCEL_URL`, then the request. |

The first four must be copied **verbatim** from the QMS backend's `.env`. The
three things shared with QMS are `JWT_SECRET`, `ENCRYPTION_KEY` and the master
Supabase itself; breaking any of them breaks the running QMS too.

`lib/env.ts` reads secrets at call time rather than caching at module load, so a
Vercel environment change takes effect on the next cold start with no stale
constants. A missing variable fails with a message naming the variable, not with
`undefined` three layers down.

> **`PLATFORM_ACCOUNT` gotcha.** The `.env.example` default is `orcanos`, but the
> value this console runs on is **`orcanosdemo`** — that account has the
> `auth_methods` row, and it is what `.env.local` now carries. It was renamed
> from `demo` on 2026-08-29 (CLAUDE.md → *Current state*), so **a Vercel
> environment still set to `demo` is now pointing at an account that does not
> exist.** With the wrong value, `GET /api/auth/config` answers 404 and the login
> screen offers no sign-in methods at all. The 404 body says exactly which
> account it looked for.

## 2. Local development

```bash
cd "c:\AI Projects\compliance-platform\account-management"
npm install
cp .env.example .env.local     # then fill it in
npm run dev                    # http://localhost:3100
```

Or `run_dev.bat`, which frees port 3100, creates and opens `.env.local` if it is
missing (then stops — the app cannot start without it), installs deps on first
run, and runs the dev server in the foreground so Ctrl+C works.

`.env.local` is gitignored, along with `.env` and `.env*.local`.

Node ≥ 20 is required (`engines` in `package.json`).

## 3. The one migration

Run once against the **master** Supabase, in the SQL editor:

```
sql/001_account_provisioning.sql
```

Purely additive — one new table, nothing QMS reads or writes is touched, so
applying it cannot affect the running QMS. Account creation fails with a clear
message until it is applied; everything else works without it. Rollback is
commented at the bottom of the file.

There is no migration runner. See [SCHEMA.md §7](SCHEMA.md#7-migrations).

## 4. OAuth redirect URIs

Sign-in reuses the platform account's existing Google / Microsoft OAuth app — the
`client_id` and secret come from its `auth_methods` row, exactly as QMS does.
Only the redirect URI differs, so each deployment's callback must be added to the
OAuth client:

```
http://localhost:3100/auth/callback                  development
https://accounts.orcanos.ai/auth/callback            production   ← the live one
https://<preview-url>/auth/callback                  each preview, if OAuth is needed there
```

⚠️ **`https://accounts.orcanos.ai/auth/callback` must be present in the Google
OAuth client or production Google sign-in fails with `redirect_uri_mismatch`.**
The console is deployed and everything else answers correctly; this is the one
step that lives in the Google Cloud console and cannot be scripted from here.

- **Google:** APIs & Services → Credentials → the OAuth client → Authorised
  redirect URIs.
- **Microsoft:** App registrations → Authentication → Redirect URIs.

The `redirect_uri` must match byte-for-byte between the authorize call and the
token exchange, which is why both sides derive it from `appOrigin()`.

Local password sign-in works without any of this.

## 5. Vercel setup

**As built (2026-08-29).** This is done; the list below is the record, not a
to-do.

| | |
|---|---|
| Vercel project | `account-management` (team `zohars-projects-11ab50b7`) |
| Git | connected to `zoharp/account-management`; **a push to `main` is a production deploy** |
| Production domain | `https://accounts.orcanos.ai` — `accounts.orcanos.ai` CNAME → `cname.vercel-dns.com` |
| Environment | every variable from §1 set for **Production and Preview** |
| Framework preset | Next.js, auto-detected, no build overrides |

> Ask Paul is the separate Vercel project **`zorgolite`** on
> `askpaul.orcanos.ai`. Serving this console at `askpaul.orcanos.ai/accounts`
> instead would need `basePath: '/accounts'` here, the ~23 absolute
> `fetch('/api/…')` calls and the OAuth `redirect_uri` reworked, and a rewrite
> added to the QMS frontend's `vercel.json` — i.e. a change to the live Ask Paul
> deployment. Its own subdomain was chosen to avoid all of that; both are under
> `orcanos.ai`, so a future `.orcanos.ai` session cookie is still shared.

To recreate it from scratch:

1. Import `zoharp/account-management` as a new Vercel project. Framework preset
   Next.js; no build overrides needed.
2. Set every variable from §1 in Project Settings → Environment Variables, for
   **Production and Preview**.
3. Add the production `/auth/callback` URL to the OAuth client (§4).
4. Apply the migration (§3) if it has not been applied already.
5. Deploy.

Preview deployments get a fresh URL per branch. They point at the **same master
Supabase and the same tenant accounts as production** — there is no staging
database for this app. Treat a preview as production access.

## 6. Deploying

`deploy.bat` is the intended path:

```
[1/5] npm install if node_modules is missing
[2/5] npx tsc --noEmit         ← fails here, nothing is deployed
[3/5] npx next build           ← fails here, nothing is deployed
[4/5] git add -A, prompt for a commit message
[5/5] type DEPLOY to push      ← anything else stops, commit stays local
```

The build gate runs **before** the commit prompt, so a broken build never reaches
a red Vercel deploy. Equivalent by hand:

```bash
npm run typecheck
npm run build
git add -A && git commit -m "..."
git push          # ← this is the deploy
```

Vercel builds on push to `main`.

## 7. Post-deploy verification

1. `/login` loads and offers the expected sign-in methods.
2. Sign in with an `@orcanos.com` admin. A non-admin, or a non-Orcanos address,
   is refused **at sign-in** — not after.
3. `GET /api/accounts` while signed out returns **404**, not 403.
4. The accounts list totals and dates match what the QMS panel shows for the same
   accounts.
5. Run all three connection tests on one account and compare with QMS —
   especially the SQL Server one, see §9.
6. The audit log shows the sign-in from step 2.

## 8. Rollback

The app is stateless; rolling back is a Vercel redeploy of the previous
deployment, or a `git revert` and push.

The migration does not need reverting — `account_provisioning` is additive and
unread by QMS. Rolling back the app while jobs are mid-flight leaves those rows
in a non-terminal state; they are not resumed automatically, so check for orphans
(query in [SCHEMA.md §3](SCHEMA.md#3-account_provisioning)) and de-provision any
project that never got an `accounts` row.

Never roll back `ENCRYPTION_KEY` or `JWT_SECRET` independently of QMS.

## 9. Before retiring the QMS Accounts panel

The QMS panel is still live and both read the same production data. Do not remove
it until:

1. The same account verifies in both apps — list totals, detail fields, all three
   connection tests, billing figures.
2. ⚠️ **SQL Server reachability from Vercel is confirmed for at least one real
   customer account.** Tests here use `mssql`/tedious because Vercel has no ODBC
   driver; a customer SQL Server firewalled to the Cloud Run egress IPs will
   refuse Vercel. This is an infrastructure question, not a code one, and it is
   the single blocking item.
3. One real account has been created end to end here, with `account_provisioning`
   showing no orphan rows afterwards.

Then, in the QMS repo: drop `onOpenAccounts` from `App.jsx`, the menu item in
`ChatHistory.jsx:246-250`, and the four `Account*.jsx` components. Leave the
backend endpoints in place until nothing calls them.
