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
| Identity | `id` (uuid), `account_name`, `is_active`, `created_at`, `updated_at` | `account_name` is matched **case-insensitively** everywhere — `accountCiFilter()` in `lib/supabase.ts`, a PostgREST `ilike` with `%`, `_` and `\` escaped — and is **unique on `lower(account_name)`**, `sql/004_account_name_unique.sql`. See below. |
| **Residency** | `region` | `'us'` or `'eu'`, `not null default 'us'`, CHECK-constrained. **Owned by this app** — `sql/003_account_region.sql`. See below. |
| Legacy DB pair | `db_type`, `db_host`, `db_name`, `db_user`, `db_password_encrypted`, `connection_string` | Still read on some QMS paths. Kept in sync with the vector pair. **Four of these are NOT NULL — see below.** |
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

### `account_name` is unique, and the index is the only check that counts

`accounts_account_name_lower_key` — a unique index on `lower(account_name)`,
`sql/004_account_name_unique.sql`. Three checks refuse a duplicate name and only
this one cannot race:

| Where | What it does |
|---|---|
| `CreateAccountModal` | Greys out **Create** and explains, matching master account names *and* traceability tenants. A convenience — it is comparing a list the browser loaded some time ago. |
| `POST /api/accounts` | 409 on an existing `accounts` row, and 409 on an **in-flight `account_provisioning` job** for the same name. |
| The index | Refuses the INSERT. |

The API checks then inserts, and on the provisioning path those two are *minutes*
apart — the name is checked when the job starts, the row is written by
`tickSavingAccount` once the Supabase project is healthy. That is why the
in-flight-job check exists (nothing else marks the name as taken during the gap)
and why the index exists (the gap cannot be closed in application code). Both
insert sites treat a `23505` as "already exists": the route answers 409, and
`tickSavingAccount` fails the job with a message naming the orphaned Supabase
project, because that project is real and billed and only an operator can decide
what happens to it. `isUniqueViolation()` in `lib/supabase.ts` is the detector.

Uniqueness is *case-insensitive* because every reader is. Two rows differing only
in case would be indistinguishable to `accountCiFilter()`, and since
`account_name` is an FK-less text key in five tables (rule 3 above), every one of
those lookups takes `rows[0]` — arbitrarily one tenant's LLM key, auth config or
usage read against the other's account.

`GET /api/accounts/:id` returns an explicit column allow-list containing **zero**
`*_encrypted` columns. Check any column you add against that list.

### ⚠️ `region` is immutable, and every way it goes wrong is silent

`region` is GDPR data residency, and it is one decision that **three stores with nothing joining
them** must obey:

| # | Store | Follows `region` via |
|---|---|---|
| 1 | The tenant's own Supabase project (Ask Paul's vector DB) | `supabaseRegionFor()` in `lib/regions.ts`, used by `lib/provisioning.ts` |
| 2 | The traceability instance's SQLite — **one Fly app per region**, own volume, own Litestream bucket | `traceApiUrlFor()`; `TRACE_API_URL` = us, `TRACE_API_URL_EU` = eu |
| 3 | LLM calls made for that tenant | *not yet implemented* — see the 0.4.0 changelog entry |

**It cannot be changed after provisioning.** Supabase cannot relocate a project and a Fly volume is
pinned to one region, so rewriting the value moves no data — it only points every reader at a region
that does not hold the tenant, while the console asserts a residency guarantee that is false. That is
worse than the original mistake. `PATCH /api/accounts/:id` therefore **refuses `region` with a 400**
rather than dropping it from `PATCHABLE` silently — the same treatment `account_name` gets, and for
the same reason. Moving a tenant is a create → migrate → verify → delete, and that process writes the
new value at the end.

Why the guard rails are what they are: a tenant provisioned in the wrong region works perfectly, a
tenant looked up in the wrong traceability instance simply appears not to exist, and a US LLM call
for an EU tenant returns a normal answer. **No error path surfaces a residency mistake.** Hence: no
fallback between regions anywhere in `lib/trace.ts`; a present-but-unknown value is a 400 rather than
being coerced to `us` (`parseRegion` vs `coerceRegion`); and `upsertTraceModules` refuses outright
when a tenant's existing instance disagrees with the region master records.

Every pre-existing row is `us`, which is a statement of fact rather than a default: provisioning has
always used `SUPABASE_PROJECT_REGION` (default `us-east-1`) and the only traceability instance runs
in Fly `iad`.

### ⚠️ Five columns are NOT NULL with no default

Inherited from QMS, and not obvious from the app's own code because until 0.3.0 every insert came
from the provisioning job, which fills all of them from the Supabase project it has just created:

```
account_name            text  not null
db_type                 text  not null
db_name                 text  not null
db_user                 text  not null
db_password_encrypted   text  not null
```

`id` is `not null` too but defaults to `gen_random_uuid()`, so it can be omitted. **Everything
else on `accounts` is nullable.**

Omitting any of the four `db_*` columns fails with PostgREST `23502`
(`not_null_violation`) — and the error surfaces as a bare tuple of nulls in `details`, with the
`message` naming the actual column often truncated by whatever renders it. That cost a release
(0.3.0 → 0.3.1).

An account with **no** database — the normal case since 0.3.0, because only Ask Paul needs one —
writes empty strings into all four. Empty already means "not configured" everywhere in this
codebase (`orcanosTestLogin` answers `{success: null}` on an empty secret, rendered as a neutral
note). Making them nullable is the cleaner fix and requires QMS to agree that null is legal there,
since it reads the same table.

To re-check this list against the live database rather than trusting this file:

```sql
select column_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'accounts'
order by ordinal_position;
```

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
| `iso27001_control_resolved` | `PATCH /api/iso27001/[id]` — group *Compliance* |

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

Run once each, by hand, through the Supabase Management API `database/query` route (see
[CLAUDE.md](CLAUDE.md) → *Current state*). Every file is `if not exists` and safe to re-run.

| File | State in master |
|---|---|
| `sql/001_account_provisioning.sql` | applied 2026-08-29 |
| `sql/002_orcanos_identity.sql` | applied 2026-08-29 |
| `sql/003_account_region.sql` | applied 2026-09-10 |
| `sql/004_account_name_unique.sql` | ⚠️ **outstanding** |
| `sql/005_iso27001_controls.sql` | applied 2026-09-16 |
| `sql/006_iso27001_history.sql` | applied 2026-09-16 |

There is no migration runner here — unlike quiz-management's ledger-backed
GitHub Actions runner. Revisit that before the next one; five hand-run files with two
forgotten is the argument.

Account creation fails with a clear message until `001` is applied. `POST /api/auth/local/login`
500s on every attempt until `002` is applied (the columns it filters on don't exist). A rollback is
commented at the bottom of each file.

After a **master restore** ([docs/compliance/DISASTER_RECOVERY.md §5.2](docs/compliance/DISASTER_RECOVERY.md#52-master-data-corruption-bad-migration-or-accidental-delete)),
re-run every file applied after the backup's timestamp.

## 8. `iso27001_controls`

**Owned by this app** — `sql/005_iso27001_controls.sql`. ISO/IEC 27001:2022 Annex A status per
*internal system* (not per customer), seeded from the `compliance-audit` skill's ledger. How the
screen uses it: [docs/compliance/ISO27001.md §5](docs/compliance/ISO27001.md#5-the-iso-27001-audit-screen).

| Column | Type | Written by | Notes |
|---|---|---|---|
| `id` | uuid pk | default | |
| `system_name` | text not null | seed | Key from `lib/iso27001-systems.ts`, e.g. `orcanos-qms` |
| `control_id` | text not null | seed | `A.5.1` … `A.8.34`. **Sorts lexically in PostgREST** — the route re-sorts numerically |
| `title`, `theme` | text not null | seed | Theme: Organizational / People / Physical / Technological |
| `status` | text not null | seed / import **only** | pass · partial · fail · blocked · not_applicable. Never written by the app |
| `check_ids` | jsonb `[]` | seed | Skill check ids behind the status |
| `evidence` | text | seed | Automated finding text |
| `last_checked` | date | seed | |
| `resolved` | bool not null default false | `PATCH /api/iso27001/[id]` | |
| `resolution_answer` | text | PATCH | Required on resolve |
| `resolution_evidence_link` | text | PATCH | http(s) only |
| `resolved_status` | text | PATCH | Operator's asserted status, independent of `status` |
| `resolved_by` | bigint | PATCH | master `users.id`, no FK |
| `resolved_at`, `created_at`, `updated_at` | timestamptz | PATCH / default | |

Unique on `(system_name, control_id)`; index on `(system_name, status)`. This is the **current**
view only. Newer runs arrive through `POST /api/iso27001/runs`, which upserts the automated columns
(`title`, `theme`, `status`, `check_ids`, `evidence`, `last_checked`) on that unique index and sends
no resolution column. The `resolution_*`/`resolved*` columns mirror the latest entry of
`iso27001_control_notes`.

## 9. ISO 27001 history — `iso27001_audit_runs`, `iso27001_run_controls`, `iso27001_control_notes`

**Owned by this app** — `sql/006_iso27001_history.sql`. Nothing in the app updates or deletes a row
in any of the three.

| Table | One row per | Key columns |
|---|---|---|
| `iso27001_audit_runs` | imported skill run, per system | `id` uuid pk · `system_name` · `framework` · `run_date` date (ledger `last_run`) · `source` `seed`/`import` · `imported_by` (users.id, no FK), `imported_by_email` · `control_count` · `summary` jsonb `{status: n}` · `created_at`. Index `(system_name, run_date desc, created_at desc)` |
| `iso27001_run_controls` | control in a run | pk `(run_id, control_id)`, `run_id` FK → runs **on delete cascade** · `title`, `theme`, `status`, `check_ids`, `evidence` as that run saw them |
| `iso27001_control_notes` | save in the resolve dialog | `id` uuid pk · `system_name`, `control_id` (not the controls row id) · `run_id` FK → runs on delete set null (current run when written) · `answer` not null · `evidence_link` · `asserted_status` · `resolved` bool · `author_id`, `author_email` · `created_at`. Index `(system_name, control_id, created_at desc)` |

Backfill: 005's `orcanos-qms` seed becomes a `source='seed'` run, and any existing resolution its
first note. The rollback at the bottom of the file drops all three — export first.
