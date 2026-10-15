-- ─────────────────────────────────────────────────────────────────────────
-- 008_platform_settings.sql
--
-- Run ONCE against the MASTER / platform Supabase database (the one holding
-- `accounts`). Purely additive: one new table, one seeded row.
--
-- WHY: platform-wide settings that apply to EVERY account, edited here and read
-- by Ask Paul (QMS AI). First user: key `credits` — how a cost in USD turns into
-- the "credits" customers see (they never see $ or tokens).
--
-- SHAPE of key `credits`: {"credits_per_usd": 100, "markup": 1.0}
--   credits = cost_usd * markup * credits_per_usd
-- Credits are computed when read, never stored, so changing this re-prices history.
-- A missing table or row means the same defaults (100 / 1.0) in Ask Paul.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists platform_settings (
  key         text primary key,
  value       jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

alter table platform_settings enable row level security;

insert into platform_settings (key, value)
values ('credits', '{"credits_per_usd": 100, "markup": 1.0}'::jsonb)
on conflict (key) do nothing;
