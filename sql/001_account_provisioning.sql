-- ─────────────────────────────────────────────────────────────────────────
-- 001_account_provisioning.sql
--
-- Run ONCE against the MASTER / platform Supabase database — the same one the
-- Orcanos QMS backend calls SUPABASE_URL, holding `accounts`, `users`,
-- `auth_methods`, `account_usage_logs` and `security_audit_log`.
--
-- Purely additive: it creates one new table and touches nothing the QMS app
-- reads or writes, so applying it cannot affect the running QMS.
--
-- WHY IT EXISTS
-- The QMS backend provisions an account's Supabase project inside a single
-- long-lived streaming request. On Vercel that request can hit the function
-- duration limit part-way through, which leaves a real, billable Supabase
-- project with no `accounts` row pointing at it and nothing recording that it
-- was ever requested. This table makes each provisioning attempt durable, so a
-- job survives a timeout, a redeploy or a closed browser, and an abandoned
-- attempt is visible rather than being an invisible orphan project.
--
-- Secrets are stored the same way they are everywhere else in this schema:
-- AES-256-GCM ciphertext under the platform ENCRYPTION_KEY, never plaintext.
-- They are nulled out as soon as the job reaches `done`.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists account_provisioning (
  id                     uuid primary key default gen_random_uuid(),
  account_name           text not null,

  -- Supabase project being provisioned (null until the Management API answers)
  project_ref            text,
  project_status         text,

  -- Encrypted, and cleared on completion
  db_password_encrypted  text,
  service_key_encrypted  text,

  -- The Orcanos fields typed into the create form, held until the account row
  -- can be written. Any password inside is already ciphertext.
  payload                jsonb,

  -- creating_project | waiting_healthy | fetching_keys | running_schema
  -- | saving_account | done | error
  state                  text not null default 'creating_project',
  message                text,

  account_id             uuid references accounts(id) on delete set null,
  requested_by_email     text,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists idx_account_provisioning_state
  on account_provisioning(state);

create index if not exists idx_account_provisioning_created
  on account_provisioning(created_at desc);

create index if not exists idx_account_provisioning_account_name
  on account_provisioning(account_name);


-- ── Finding orphans ──────────────────────────────────────────────────────
-- Jobs that created a Supabase project but never produced an account row.
-- Each one is a project still being billed. De-provision it in the Supabase
-- dashboard, then delete the row.
--
--   select id, account_name, project_ref, state, message, created_at
--   from   account_provisioning
--   where  project_ref is not null
--     and  account_id  is null
--   order  by created_at desc;


-- ── DOWN (rollback) ──────────────────────────────────────────────────────
-- drop table if exists account_provisioning;
