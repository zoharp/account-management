# Platform authentication — where it stands across the five projects

Workspace-level note. Each project's own `CLAUDE.md` remains the source of truth
for its codebase; this file exists because authentication is the first thing the
consolidation has to reconcile, and the five apps currently do it four different
ways.

Referenced from
[`README.md`](../../README.md) and
[`SECURITY.md`](../../SECURITY.md).

---

## 1. The five

| # | Project | Identity source | Session | Where the session lives |
|---|---|---|---|---|
| 1 | `covaris-bom` | Orcanos `QW_Login` | none — the Basic auth header *is* the session | `localStorage` |
| 2 | `Orcanos QMS` | `auth_methods` (Google / Office 365 / local bcrypt), plus a legacy Supabase-Auth path | HS256 JWT, 24h, `iss: "orcanos-qms"` | `localStorage` |
| 3 | `quiz-management` | Supabase Auth (`signInWithPassword`, `signUp`, `resetPasswordForEmail`) | Supabase session | Supabase JS client |
| 4 | `traceability-matrix` | Orcanos `qw_login`, proxied | server-side session row + CSRF token | `session_id` httpOnly cookie + readable `csrf_token` cookie |
| 5 | `account-management` | `auth_methods` (Google / Office 365 / local) — **the same rows as #2** | **the same JWT as #2** | `session_token` httpOnly cookie |

Two of these are genuinely the same system (#2 and #5). The other three are
independent.

## 2. The one place two apps already interoperate

`Orcanos QMS` and `account-management` share three things, deliberately:

| Shared | Consequence of a mismatch |
|---|---|
| `JWT_SECRET` | Sessions stop interoperating. Same claims, same expiry, same issuer — a token from either app is accepted by the other. |
| `ENCRYPTION_KEY` | Existing account secrets become undecryptable across both apps. |
| The master Supabase | `accounts`, `users`, `auth_methods`, `account_usage_logs`, `security_audit_log`, `account_llm_keys`. |

This is the only cross-app session compatibility that exists today, and it exists
because #5 was extracted from #2 rather than designed separately. It is worth
treating as the template: **a shared `users` + `auth_methods` table and one JWT
format**, rather than a shared login *screen*.

Rotation rule: `ENCRYPTION_KEY` and `JWT_SECRET` must never change in one app
alone. The tool is `backend/rotate_encryption_key.py` in the QMS repo, and it
must run before the env var changes, covering both apps.

## 3. The two identity models, honestly stated

**Orcanos credentials** (#1, #4, and the tenant-facing parts of #2). The user
types their Orcanos username and password; the app calls `QW_Login` and treats a
success as proof of identity. Attractive because there is no second account to
provision — the customer's existing Orcanos user *is* the identity. The cost is
that the app never holds a verifiable identity token of its own, only a
credential it must either keep (#1, in `localStorage`) or exchange for a session
of its own making (#4).

**A platform account** (#2, #3, #5). Identity is a row the platform owns —
`users` + `auth_methods` in #2/#5, Supabase Auth in #3 — with SSO on top. More to
provision, but it gives roles, an audit trail keyed to a stable id, and the
ability to revoke.

These are not reconcilable by picking a winner per app. Any merged platform has
to choose one primary and bridge the other.

## 4. Notable differences worth not flattening

- **#1 stores an Orcanos Basic auth header in `localStorage`.** It is a
  read-only BOM browser with no backend, so there is nowhere else to put it, but
  it is the weakest of the five and should not be the model for anything.
- **#4 is the only one with server-side session state and CSRF tokens.** Sessions
  are rows with an idle timeout (`SESSION_TIMEOUT`, default 2700s) that is
  extended on use; `session_id` is httpOnly and `csrf_token` is deliberately
  readable so JavaScript can echo it in a header. That is a genuinely different —
  and in some ways stronger — model than a stateless JWT, because it can be
  revoked server-side.
- **#2 and #5 use the same token but store it differently.** `localStorage` in
  QMS, httpOnly cookie in the control plane. The token format is unchanged; only
  where the browser puts it. See
  [`SECURITY.md` §2](../../SECURITY.md#2-sessions).
- **#5 deliberately declines three things #2 does:** it does not auto-create a
  `users` row on OAuth, it hard-fails the OAuth `state` check, and it does not
  accept the legacy Supabase-Auth token. Those are not gaps to close.
- **#3's route guards are cosmetic.** They are client-side `localStorage` reads;
  the real boundary is RLS in the database (migration `013`). #2 and #5 are the
  inverse — no RLS at all, because all access uses the service key, so the
  application-level gate is the only boundary.

## 5. Decisions and open questions for the consolidation

**Decided 2026-08-28 — #5's identity model is a platform account *linked* to an
Orcanos login**, not Orcanos credentials held directly and not a bare platform
account. Built in `account-management` `0.2.0`:

- The `users` row (person, real email, admin-created) stays the identity of
  record — no auto-provisioning, unchanged.
- What changed is how the *password* is verified: `POST /api/auth/local/login`
  now calls `QW_Login` against the platform account's own Orcanos tenant
  instead of checking bcrypt against `users.password_hash`.
- The join from a `QW_Login` response (which carries no email) back to a
  `users` row is two new columns, `orcanos_user_name` (admin-set) and
  `orcanos_account` (filled by the app on first successful login) — see
  `account-management/sql/002_orcanos_identity.sql` and
  `account-management/CLAUDE.md` §"Orcanos sign-in" for the full gate.
- This resolves §3's identity-model question **for #5 only**. #1
  (`covaris-bom`) and #4 (`traceability-matrix`) still authenticate with
  Orcanos credentials directly, unchanged, and are not part of this decision.
  #2 (`Orcanos QMS`) still has `auth_methods` (Google / Office 365 / local
  bcrypt) as well — this did not touch QMS.
- ~~**Not yet applied to the master DB**~~ — `002_orcanos_identity.sql` was
  applied 2026-08-29.
- ✅ **Confirmed working 2026-08-30**, first successful Orcanos sign-in:
  `security_audit_log` `login_succeeded` at `01:43:32Z`, `method: "orcanos"`.
  The `orcanos_user_name` / `orcanos_account` join works, and
  `linkOrcanosAccount()` bound that row on first success.

⚠️ **The tenant pin described above is gone, and the reason matters to the
consolidation (2026-08-30).** The gate no longer derives the expected tenant
from the platform account's stored `orcanos_api_url`; `account-management`
`0.2.7` made the sign-in URL a **free-text field on the login screen**, at the
product owner's explicit request. What replaces the pin is a host allowlist
(`ORCANOS_LOGIN_HOST_ALLOWLIST`, defaulting to `orcanos.com` since `0.2.8`), so
the *host* is constrained and the *tenant* is not. Recorded as accepted risk B-1
in `account-management/SECURITY.md` §9.2.

This is not a detail to flatten when the five projects converge, for one
concrete reason: **the platform's own admins do not live in `PLATFORM_ACCOUNT`.**
`PLATFORM_ACCOUNT` is `orcanosdemo`; the verified sign-in above was against
tenant **`orcanos`**. Under the pinned design that login was refused
(`wrong_orcanos_tenant`) no matter how correct the password — which is why it
had never once succeeded. Any consolidated model that re-pins a single tenant
locks out every current platform admin. The real requirement is *one identity
across several Orcanos tenants*, which is what the `orcanos_account` column was
kept for (§"Orcanos sign-in" in that repo's CLAUDE.md) — a `user_identities`
table, not a pin.

The remaining items below are still open.

1. ~~Which identity model is primary?~~ Answered above, for #5.
2. **Stateless JWT or server-side sessions?** #4's revocable session rows solve a
   real problem that #2/#5's JWTs do not — a compromised token is valid until it
   expires. The 24h expiry is the current mitigation, and it is thin for a
   console that administers every tenant.
3. **One `users` table or several?** #2/#5 already share one. #3 has its own
   (`user_profiles` / `user_accounts`), #1 and #4 have none of their own.
4. **Where does role live?** #2/#5 use `users.role` read fresh on every request.
   #3 uses account membership rows. There is no shared vocabulary yet.
5. **Does the shared audit trail extend?** `security_audit_log` is currently
   written by #2 and #5 only. It is the natural place for #1, #3 and #4 to write
   too, and doing so is cheap.
6. **What happens to `PLATFORM_ACCOUNT`?** #5 reads its login configuration from
   exactly one account's `auth_methods` row. Today that must be `orcanosdemo`
   (`demo` until the 2026-08-29 rename), which is still an accident of which row
   exists rather than a decision — the rename aligned the *name* with the
   Orcanos tenant, it did not decide which account the console should
   authenticate against.

## 6. If nothing else is carried forward

Two things from #5 are worth keeping in whatever comes next, because both were
chosen against the easier alternative:

- **Authorisation reads the database, not the token.** Revoking an admin takes
  effect on the next request, not at token expiry.
- **A gate that answers 404 rather than 403** on privileged routes, so an
  unauthorised caller cannot enumerate what exists.
