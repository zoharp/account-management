-- ─────────────────────────────────────────────────────────────────────────
-- 003_account_region.sql
--
-- Run ONCE against the MASTER / platform Supabase database — the same one the
-- Orcanos QMS backend calls SUPABASE_URL, holding `accounts`, `users`,
-- `auth_methods`, `account_usage_logs` and `security_audit_log`.
--
-- Purely additive: one new column with a default, so applying it cannot affect
-- the running QMS. Every existing row becomes 'us', which is where every
-- existing tenant's data actually is (SUPABASE_PROJECT_REGION has defaulted to
-- us-east-1 since provisioning was written, and the traceability instance runs
-- in Fly `iad`). The default is therefore a statement of fact, not a guess.
--
-- WHY IT EXISTS — GDPR data residency
-- An EU customer's personal data must not rest in the US. Three separate stores
-- hold some of it, and this column is the single decision all three follow:
--
--   1. The tenant's own Supabase project (Ask Paul's vector DB) — created in
--      this region by `lib/provisioning.ts` instead of the global env var.
--   2. The traceability instance's SQLite — a SEPARATE Fly app per region
--      (`iad` and `fra`), each with its own volume and its own Litestream
--      bucket. The tenant's `account_access` row lives in exactly one of them.
--   3. Any LLM call made for that tenant — an EU tenant must route to a
--      regional Bedrock endpoint, not the US Anthropic API.
--
-- Region 2 and 3 are what make the claim true. Storing EU data in `fra` while
-- the AI call still ships trainee names to a US endpoint is not compliance, and
-- nothing in the UI would show the difference.
--
-- ⚠️ THIS COLUMN IS IMMUTABLE AFTER PROVISIONING.
-- Supabase cannot move a project between regions, and a Fly volume is pinned to
-- one. Changing the value does NOT move any data — it only makes every reader
-- look in the wrong place, which is worse than the original problem because the
-- console would then assert compliance that does not hold. Moving a tenant
-- between regions is a create-migrate-verify-delete, and the value is written by
-- that process at the end, never by an edit form. `PATCH /api/accounts/:id`
-- rejects it for this reason.
-- ─────────────────────────────────────────────────────────────────────────

alter table accounts
  add column if not exists region text not null default 'us';

-- Only the two regions the platform actually deploys into. A third value would
-- silently mean "us" to `supabaseRegionFor()` and "no EU app" to the router, so
-- it is refused at the database rather than being interpreted downstream.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'accounts_region_check'
  ) then
    alter table accounts
      add constraint accounts_region_check check (region in ('us', 'eu'));
  end if;
end $$;

comment on column accounts.region is
  'GDPR data residency. ''us'' or ''eu''. Decides which Supabase region the '
  'tenant''s own project is created in, which traceability Fly app holds its '
  'row, and which LLM endpoint its AI calls may use. IMMUTABLE after '
  'provisioning — changing it moves no data, it only makes readers look in the '
  'wrong region. See sql/003_account_region.sql.';
