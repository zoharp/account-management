-- ─────────────────────────────────────────────────────────────────────────
-- 002_orcanos_identity.sql
--
-- Run ONCE against the MASTER / platform Supabase database — the same one the
-- Orcanos QMS backend calls SUPABASE_URL, holding `accounts`, `users`,
-- `auth_methods`, `account_usage_logs` and `security_audit_log`.
--
-- Purely additive: two nullable columns and one unique index on `users`.
-- Touches nothing QMS reads or writes today, so applying it cannot affect the
-- running QMS.
--
-- WHY IT EXISTS
-- Platform sign-in moves from bcrypt against `users.password_hash` to Orcanos
-- `QW_Login`. QW_Login returns no email — only `User_details.User_name`
-- (unique per tenant, not globally) and `User_details.Virtual_dir` (the tenant
-- itself). These two columns are the join key from a QW_Login response back to
-- a master `users` row. See CLAUDE.md "Planned: Orcanos sign-in" for the full
-- gate this supports.
--
-- `orcanos_account` always holds exactly one value today (PLATFORM_ACCOUNT's
-- own Virtual_dir) because this console is single-tenant. Kept as a real
-- column anyway — carrying the tenant dimension now means going multi-tenant
-- later is a data migration into a `user_identities` table, not a redesign.
-- ─────────────────────────────────────────────────────────────────────────

alter table users
  add column if not exists orcanos_user_name text,
  add column if not exists orcanos_account   text;

-- Case-insensitive: two different-cased usernames on the same tenant must
-- not both link to a row (QW_Login usernames are not case-sensitive on the
-- Orcanos side). Partial index — most rows will have neither column set,
-- since not every platform staff member signs in via Orcanos.
create unique index if not exists idx_users_orcanos_identity
  on users (orcanos_account, lower(orcanos_user_name))
  where orcanos_account is not null and orcanos_user_name is not null;


-- ── DOWN (rollback) ──────────────────────────────────────────────────────
-- drop index if exists idx_users_orcanos_identity;
-- alter table users
--   drop column if exists orcanos_user_name,
--   drop column if exists orcanos_account;
