-- ─────────────────────────────────────────────────────────────────────────
-- 007_regulatory_modules.sql
--
-- Run ONCE against the MASTER / platform Supabase database (the one holding
-- `accounts`). Purely additive: one nullable-by-default jsonb column.
--
-- WHY: Ask Paul's regulatory modules (FDA 510(k), MDSAP, Standards) were always
-- visible to every account. This column lets the console show/hide each one per
-- account. Ask Paul reads it per request and answers 403 for a hidden module.
--
-- SHAPE: {"fda_510k": bool, "mdsap": bool, "standards": bool}. A MISSING key means
-- the module's default, so applying this migration changes nothing by itself:
--   fda_510k  default ON   (every account already had it)
--   mdsap     default ON   (every account already had it)
--   standards default OFF  (new module — opt-in per account)
-- ─────────────────────────────────────────────────────────────────────────

alter table accounts add column if not exists regulatory_modules jsonb not null default '{}'::jsonb;
