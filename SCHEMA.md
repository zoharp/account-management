# account-management — Schema

Every table this app touches lives in the **master / platform Supabase** — the
same database the Orcanos QMS backend calls `SUPABASE_URL`. This app creates no
database of its own.

Six of the seven tables are **shared with QMS**, which still reads and writes
them. Only `account_provisioning` belongs to this app alone.

- [ARCHITECTURE.md](ARCHITECTURE.md) — how these are used
- [SECURITY.md](SECURITY.md) — what may and may not leave the server
- QMS `MD files/SCHEMA.md` §10, §18, §19 — the authoritative definitions of the
  shared tables. Column shapes in `src/lib/types.ts` track those sections.

---

## 1. Ownership

| Table | This app | QMS | Owner of the definition |
|---|---|---|---|
| `accounts` | read / write | read / write | QMS `SCHEMA.md` §10 |
| `users` | read, `last_login_at` write | read / write | QMS `SCHEMA.md` §6, §12 |
| `auth_methods` | read | read / write | QMS `SCHEMA.md` §12 |
| `account_llm_keys` | read (status only) | read / write | QMS `SCHEMA.md` §10 |
| `account_usage_logs` | read | write | QMS `SCHEMA.md` §18 |
| `security_audit_log` | write, read | write, read | QMS `SCHEMA.md` §19 |
| `account_provisioning` | **read / write** | not used | **this app**, `sql/001_account_provisioning.sql` |

Nothing here is a per-tenant table. Tenant vector databases are touched only
once, during provisioning, to run the bootstrap DDL.

## 2. `accounts` — the tenant registry

One row per customer. The column groups matter more than the individual names:

| Group | Columns | Purpose |
|---|---|---|
| Identity | `id` (uuid), `account_name`, `is_active`, `created_at`, `updated_at` | `account_name` is matched **case-insensitively** everywhere — `accountCiFilter()` in `lib/supabase.ts`, a PostgREST `ilike` with `%`, `_` and `\` escaped. |
| Legacy DB pair | `db_type`, `db_host`, `db_name`, `db_user`, `db_password_encrypted`, `connection_string` | Still read on some QMS paths. Kept in sync with the vector pair. |
| Vector DB | `vector_db_type`, `vector_db_host`, `vector_db_name`, `vector_db_user`, `vector_db_password_encrypted`, `vector_connection_string` | The account's own provisioned Supabase project. `vector_db_password_encrypted` holds its `service_role` key. |
| Orcanos SQL Server | `orcanos_db_type`, `orcanos_db_host`, `orcanos_db_name`, `orcanos_db_user`, `orcanos_db_password_encrypted`, `orcanos_connection_string` | The customer's own Orcanos database, read-only. |
| Orcanos REST | `orcanos_api_url`, `orcanos_username`, `orcanos_password_encrypted` | QMS `SCHEMA.md` §16. |

**Five `*_encrypted` columns**, all AES-256-GCM under the shared
`ENCRYPTION_KEY`: `db_password_encrypted`, `vector_db_password_encrypted`,
`orcanos_db_password_encrypted`, `orcanos_password_encrypted`, and
`account_llm_keys.api_key_encrypted`.

Three rules that are easy to break:

1. **A provisioned service key goes into `db_password_encrypted` *and*
   `vector_db_password_encrypted`.** Populating only one leaves a tenant
   half-broken in ways that show up much later.
2. **A blank password field means "keep the stored secret."** `PATCH
   /api/accounts/:id` only encrypts non-empty values. Writing an empty string
   would wipe a working credential.
3. **Renaming `account_name` is a multi-table write.** It is a text key with
   **no foreign key** in five tables — `auth_methods`, `account_llm_keys`,
   `account_usage_logs`, `account_provisioning` and `security_audit_log` — plus
   `PLATFORM_ACCOUNT` in the environment, QMS's `X-Account` header (out of
   `localStorage`) and `?account=` on QMS shared links. `PATCH
   /api/accounts/:id` therefore refuses it: `account_name` is deliberately
   absent from the writable field list in `api/accounts/[id]/route.ts`. A rename
   is a hand-run transaction. Worked example, with what was and was not updated:
   [CLAUDE.md](CLAUDE.md) → *Current state* (2026-08-29) and
   [INTERNAL_TRACE_MERGE.md §6.1](INTERNAL_TRACE_MERGE.md#61-account_name-was-renamed-to-the-tenant-2026-08-29).

`GET /api/accounts/:id` returns an explicit column allow-list containing **zero**
`*_encrypted` columns. Check any column you add against that list.

## 3. `account_provisioning`

The one table this app owns. Full DDL and rationale in
`sql/001_account_provisioning.sql`; it is purely additive and touches nothing QMS
reads, so applying it cannot affect the running QMS.

```sql
create table if not exists account_provisioning (
  id                     uuid primary key default gen_random_uuid(),
  account_name           text not null,
  project_ref            text,          -- null until the Management API answers
  project_status         text,
  db_password_encrypted  text,          -- encrypted; cleared at `done`
  service_key_encrypted  text,          -- encrypted; cleared at `done`
  payload                jsonb,         -- create-form fields; passwords already ciphertext
  state                  text not null default 'creating_project',
  message                text,
  account_id             uuid references accounts(id) on delete set null,
  requested_by_email     text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
```

Indexes on `state`, `created_at desc` and `account_name`.

`state` ∈ `creating_project` · `waiting_healthy` · `fetching_keys` ·
`running_schema` · `saving_account` · `done` · `error`. The transitions are
documented in [ARCHITECTURE.md §6](ARCHITECTURE.md#6-provisioning--the-one-significant-design-change);
the same literals are the `ProvisionState` union in `src/lib/types.ts`, so the
two must be changed together.

**Finding orphans.** A job that created a Supabase project but never produced an
account row is a project still being billed:

```sql
select id, account_name, project_ref, state, message, created_at
from   account_provisioning
where  project_ref is not null
  and  account_id  is null
order  by created_at desc;
```

De-provision the project in the Supabase dashboard, then delete the row. Run this
after any failed provisioning run.

## 4. `users` and `auth_methods`

`users` is global — one row per person across every account, keyed by email, with
`role` ∈ `admin` | `user`. This app reads `id, email, display_name, role,
auth_method, last_login_at` and writes only `last_login_at` (and `display_name`
on sign-in). It **never inserts a row**: an identity with no existing `users` row
is refused at sign-in rather than auto-provisioned.

**`orcanos_user_name` / `orcanos_account`** (`sql/002_orcanos_identity.sql`) are
the join key `POST /api/auth/local/login` uses to verify a password via
`QW_Login` instead of bcrypt — see CLAUDE.md "Orcanos sign-in". Unique on
`(orcanos_account, lower(orcanos_user_name))` where both are non-null.
`orcanos_user_name` is admin-set (SQL editor, no UI yet); `orcanos_account` is
filled by the app itself on that row's first successful `QW_Login`.

`auth_methods` is read for exactly one account — the one named by
`PLATFORM_ACCOUNT` — to decide what the login screen offers:
`google_enabled` / `google_client_id`, `office365_enabled` /
`office365_client_id` / `office365_tenant`, `local_enabled` / `password_policy`.
Client **secrets** stay server-side; only `client_id` and `tenant` reach the
browser.

If `PLATFORM_ACCOUNT` names an account with no `auth_methods` row,
`GET /api/auth/config` answers 404 with a message saying exactly that. In the
current master DB two accounts have such a row — **`orcanosdemo`** and
**`orca60`** (renamed from `demo` and `Medical Portal` on 2026-08-29) — and
`PLATFORM_ACCOUNT` names `orcanosdemo`.

## 5. Cost and audit

**`account_usage_logs`** — the master-DB mirror of per-tenant `usage_logs`, written
by the QMS backend (QMS `SCHEMA.md` §18). Read-only here. Two figures come from
it and they are not the same number:

| Figure | Source | Scope |
|---|---|---|
| List column | `account_cost_totals()` RPC | Lifetime |
| Billing modal totals | `account_usage_logs` rows for one account | **Page**, not lifetime |

The page-total behaviour was always true in QMS; the modal now says so.

**`security_audit_log`** — shared with QMS, so the two apps produce one continuous
trail (ISO 27001:2022 A.8.15 / A.8.16). Writes are best-effort and non-blocking:
a logging failure must never break the request it describes.

**The table was created on 2026-08-29** and the trail starts there — see
[SECURITY.md §8.1](SECURITY.md#81--the-trail-begins-2026-08-29). Nothing before
that date was ever written.

Events this app writes:

| Event | Where |
|---|---|
| `login_succeeded`, `login_failed`, `login_denied` | `lib/login.ts`, the three auth routes |
| `logout` | `/api/auth/logout` |
| `account_provisioning_started` | `POST /api/accounts` |
| `account_created`, `account_provisioning_failed` | `POST /api/accounts/provision/[jobId]` |
| `account_updated`, `account_deleted` | `PATCH`/`DELETE /api/accounts/[id]` |
| `account_module_changed` | `PUT /api/accounts/modules` |
| `trace_account_created`, `trace_account_updated`, `trace_account_deleted` | `/api/accounts/trace/[tenant]` |
| `trace_ai_config_changed` | `POST /api/accounts/trace/[tenant]/ai-config` |
| **Credential *use*, not change** — see [SECURITY.md §8.2](SECURITY.md#82-what-is-recorded) | |
| `orcanos_login_tested` | `POST /api/orcanos/test-login` — decrypts the saved Orcanos password when none is typed |
| `account_credentials_tested` | `POST /api/accounts/[id]/test-connections` (stored, decrypted) and `POST /api/accounts/test-connection` (`stored: false`, typed) |
| `trace_ai_key_tested` | `POST /api/accounts/trace/[tenant]/ai-config/test` — uses the tenant's stored AI key when the field is blank |

Grouping for the Audit log page's filter is defined in `lib/audit-events.ts`,
which also covers the event types QMS writes to this same table.

## 6. `sql/bootstrap_new_account.sql`

The per-account schema applied to every newly provisioned tenant database —
`documents`, `doc_chunks` (pgvector), `repositories`, `conversations`,
`usage_logs`, `settings`, the search RPCs, plus seeded reference data
(`standards`, `standard_sections`, `predefined_questions`).

Copied from the QMS repo, but **this app now owns running it**. If the per-account
schema changes, it changes here. It must ship with the deployment — `running_schema`
reads it from `process.cwd()/sql/`.

Note what a fresh tenant DB does *not* contain: there is no `users` table and no
FK to one. Owner columns (`repositories.owner_id`, `documents.owner_id`,
`conversations.user_id`, `usage_logs.user_id`, `repository_members.user_id`) are
plain `bigint` holding the master `users.id`. See QMS `SCHEMA.md` §17.

## 7. Migrations

Two files so far, each run once, by hand, in the master Supabase SQL editor:

```
sql/001_account_provisioning.sql
sql/002_orcanos_identity.sql
```

There is no migration runner here — unlike quiz-management's ledger-backed
GitHub Actions runner. A couple of additive changes didn't justify one. If a
third migration ever appears, revisit that.

Account creation fails with a clear message until `001` is applied; everything
else works without it. `POST /api/auth/local/login` 500s on every attempt until
`002` is applied (the columns it filters on don't exist). A rollback is
commented at the bottom of each file.
