# account-management — Testing

There is no automated test suite. This app was extracted from a working QMS
panel and its correctness argument is **differential**: for every screen, the
same account must produce the same answer here as it does in the QMS Accounts
panel, which is still live against the same production data.

That makes the manual plan below the actual gate, and §1 an honest record of what
has and has not been exercised.

---

## 1. What has actually been verified

Last updated: 2026-08-29.

**Verified — automated:**

| Check | Result |
|---|---|
| `npm run typecheck` (`tsc --noEmit`) | Clean |
| `next build` production build | Clean (`.next/` present, all routes compiled) |
| Dev server boots on port 3100 | Ready in ~1.5s |
| `GET /login` | 200 |
| `GET /` unauthenticated | 307 redirect |
| `GET /api/auth/config` | 200, returns Google + local for `PLATFORM_ACCOUNT=demo` — **that account is now named `orcanosdemo`; re-run after the 2026-08-29 rename** |
| `GET /api/accounts` unauthenticated | **404**, not 403 — the gate behaves |

**Verified — data preconditions:**

- `zoharp@orcanos.com` exists in the master `users` table with `role='admin'`.
  As of 2026-08-29 it also has `orcanos_user_name='rami.azulay'` set (test data
  — a real Orcanos identity on the `orcanosdemo` tenant, borrowed for this test,
  not actually zoharp's own Orcanos username).
- Two `auth_methods` rows exist, for accounts `orcanosdemo` and `orca60`.
  `PLATFORM_ACCOUNT` must be **`orcanosdemo`**, not the `.env.example` default of
  `orcanos`. (Both rows were renamed on 2026-08-29 with their accounts — see
  CLAUDE.md → *Current state*. The row count was one, for `demo`, when §1 was
  first written; the second row was found during the rename's impact check.)
- `sql/002_orcanos_identity.sql` applied to master 2026-08-29 — `orcanos_user_name`
  / `orcanos_account` exist on `users` now.
- The `orcanosdemo` account's `orcanos_api_url` is
  `https://app.orcanos.com/orcanosdemo/api/V2/Json` — confirmed live. The tenant
  pin was originally coded wrong (compared `Virtual_dir` against `PLATFORM_ACCOUNT`
  = `demo` directly, which would never match `orcanosdemo`); fixed to parse the
  tenant segment out of this URL instead (`orcanosVirtualDirFromUrl()`). **Not
  re-verified against a live `QW_Login` response since the fix.** Note the
  rename makes the two strings coincide *today* — that is a coincidence of data,
  not a reason to reintroduce the direct comparison.

**NOT yet verified — everything that matters most:**

| Not done | Why it matters |
|---|---|
| **A completed Orcanos sign-in.** Session got diverted debugging an unrelated `Orcanos QMS` local-dev port-8000 issue (a stuck/orphaned socket on the tester's machine, needs a machine restart to clear — nothing to do with this app) before a real password was ever submitted to `POST /api/auth/local/login`. | The whole gate — `QW_Login` call, `Is_admin`, tenant pin, `orcanos_account` linking, `completeLogin()` — is still unexercised end to end. **This is the next thing to do.** |
| A completed sign-in, local or OAuth (general) | The whole gate is unexercised end to end. |
| Orcanos sign-in against a real tenant | `sql/002_orcanos_identity.sql` not applied; no `users` row has `orcanos_user_name` set yet; the `Virtual_dir === PLATFORM_ACCOUNT` assumption above is unconfirmed. |
| Any screen rendered while authenticated | Accounts list, detail, billing, audit — all unrendered. |
| Any differential comparison against the QMS panel | This is the correctness argument, and none of it has been run. |
| Any connection test against a real account | Vector DB, SQL Server and Orcanos REST all unexercised. |
| A provisioning run | `readServiceKey()` has still never seen a live Management API response. |
| `sql/001_account_provisioning.sql` applied | Not applied to the master DB. Account creation will fail until it is. |
| Deployment to Vercel | Never deployed. Every Vercel-specific claim (function limits, `mssql` reachability) is reasoning, not observation. |

Treat §1 as the honest status. Update it when items move.

## 2. Prerequisites

- `.env.local` filled in — see [DEPLOYMENT.md §1](DEPLOYMENT.md#1-environment).
  `PLATFORM_ACCOUNT` must name an account that has an `auth_methods` row.
- `sql/001_account_provisioning.sql` applied to the master Supabase, for §6 only.
- `sql/002_orcanos_identity.sql` applied, and at least one `users` row given an
  `orcanos_user_name` by hand, for local sign-in to have a subject.
- `http://localhost:3100/auth/callback` registered on the OAuth client, for
  OAuth sign-in only.
- The QMS app available side by side, for the differential steps.

⚠️ There is **no staging database**. Local development, previews and production
all point at the same master Supabase and the same real tenant accounts. Steps
that write (§4 step 2, §5, §6) change production data. Do §6 with a deliberately
disposable account name and clean up afterwards.

## 3. Access control

The gate is the highest-value thing to test, because it is the only line of
defence — all master-DB access uses the service key, so there is no RLS behind it.

1. Signed out, `GET /api/accounts` → **404**. Not 403, not 401.
2. Same for `/api/accounts/:id`, `/api/audit-log`,
   `/api/accounts/:id/usage-logs`.
3. Sign in as an `@orcanos.com` user with `role='user'` → refused **at sign-in**,
   with `login_denied` in the audit log. Not refused after landing on a page.
4. Sign in with a valid non-`@orcanos.com` identity → refused at sign-in.
5. An identity with no `users` row at all → refused, `login_failed` with reason
   `no_such_user`. No `users` row is created.
6. While signed in as an admin, set that user's `role` to `user` directly in the
   database and reload → access is refused immediately, without signing out.
   This proves `role` is read from the DB, not from the JWT.
7. `/accounts` signed out redirects to `/login`; sign out returns to `/login`.

## 4. Differential — accounts list and detail

For at least two accounts, one with an Orcanos DB configured and one without:

1. **List:** name, active state, created date, lifetime cost and token totals all
   match the QMS panel.
2. **Toggle** an account's status, reload — it stuck. Toggle it back.
3. **Detail:** every field matches QMS — Orcanos SQL Server host/db/user, Orcanos
   REST URL and username, vector DB type/host, LLM key status.
4. **No ciphertext in the response.** Open devtools and confirm the
   `GET /api/accounts/:id` payload contains no `*_encrypted` field.
5. **Connection tests:** run all three and compare each result with QMS for the
   same account. An account with nothing configured must render a neutral
   "nothing to test" note, not a failure.
6. ⚠️ **The SQL Server test is the one that can legitimately differ** — see
   [DEPLOYMENT.md §9](DEPLOYMENT.md#9-before-retiring-the-qms-accounts-panel).
   A difference here is an infrastructure finding, not necessarily a bug.

## 5. Editing and secret handling

1. Edit a non-secret field, save, reload — it persisted.
2. **Leave a password field blank and save.** The stored credential must survive.
   Re-run that connection test to prove it.
3. Enter a new vector key **without testing it** → Save must refuse.
4. Test the key green, then edit any vector field → the cached green result is
   cleared and Save refuses again. (Otherwise a tick from the previous value
   would authorise a different one.)
5. Enter a deliberately wrong password, test → a clear failure, not a silent one.

## 6. Provisioning, end to end

Requires the migration. Use a disposable account name.

1. Create an account, watch the progress log. States advance
   `creating_project → waiting_healthy → fetching_keys → running_schema →
   saving_account → done`.
2. **This is the first live exercise of `readServiceKey()`.** If it fails at
   `fetching_keys`, capture the raw Management API response and tighten the
   parser against it.
3. Confirm the Supabase project exists, the bootstrap schema applied, and the
   `accounts` row is correct — including that the service key landed in **both**
   `db_password_encrypted` and `vector_db_password_encrypted`.
4. Confirm the finished job row has `db_password_encrypted`,
   `service_key_encrypted` and `payload` all **null**.
5. Run the orphan query from [SCHEMA.md §3](SCHEMA.md#3-account_provisioning) —
   no orphans.
6. **Resumability:** start a second job and close the browser during
   `waiting_healthy`. Reopen and poll — it continues from the persisted state.
7. Delete the test account. The warning that the Supabase project is **not**
   de-provisioned must be shown. Then de-provision it by hand and delete the
   `account_provisioning` row.

## 7. Audit trail

Every state-changing step above should appear in `/audit`:

`login_succeeded` · `login_failed` · `login_denied` · `logout` ·
`account_provisioning_started` · `account_created` ·
`account_provisioning_failed` · `account_updated` · `account_deleted`

Check that QMS-written events appear in the same list — the trail is shared and
must read as continuous.

Note that audit writes are best-effort: a failure logs to the server console and
does not break the request. A missing event is worth investigating but is not
proof the action did not happen.

## 8. Regression checklist for any change

- `npm run typecheck` clean.
- `npm run build` clean — `deploy.bat` gates on both before it will push.
- Any new route handler: §3 step 1 against it, and confirm 404 rather than 403.
- Any new column returned to the browser: confirm it is not `*_encrypted`.
- Any change to `lib/crypto.ts`: a value written by QMS must still decrypt here,
  and vice versa. This is the one change that can silently break the other app.
- Any change to the `ProvisionState` union: update
  `sql/001_account_provisioning.sql`'s comment and the table in
  [ARCHITECTURE.md §6](ARCHITECTURE.md#6-provisioning--the-one-significant-design-change).

## 9. If a test suite is ever added

The three things worth automating first, in order of value per effort:

1. **`lib/crypto.ts` round-trip against Python-produced fixtures.** A handful of
   ciphertexts generated by `backend/account_keys.py`, checked in, decrypted in a
   unit test. This is the highest-consequence compatibility surface and the
   easiest to test.
2. **`requirePlatformStaff()` behaviour** — 404 for anonymous, non-admin, and
   wrong-domain callers. Pure logic, no network.
3. **The provisioning state machine**, with the Management API and `pg` stubbed.
   `tickProvisioning()` is a pure step function over a persisted row, which makes
   it unusually testable.

`isSafeExternalUrl()` and `parseOdbc()` are also pure and worth a table-driven
test each.
