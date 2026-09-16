-- ─────────────────────────────────────────────────────────────────────────
-- 006_iso27001_history.sql
--
-- Run ONCE against the MASTER / platform Supabase database, after 005.
--
-- WHY IT EXISTS. 005 gave each (system, control) one row that is overwritten
-- in place: a new skill run replaces the automated status, and a new answer
-- replaces the previous answer. An auditor asks "what did it look like in
-- March, and who said what, when?" — neither is answerable from that.
--
--   iso27001_audit_runs     one row per imported `compliance-audit` run, per system
--   iso27001_run_controls   the full control list AS THAT RUN SAW IT (immutable snapshot)
--   iso27001_control_notes  every answer / evidence link / status an operator saved,
--                           append-only — the resolve dialog's history
--
-- `iso27001_controls` stays the *current* view the screen opens on. An import
-- writes a run + its snapshot and upserts the automated columns of the current
-- rows; a resolve appends a note and updates the resolution columns. Nothing in
-- the app ever updates or deletes a run, a snapshot row or a note.
--
-- BACKFILL. The 2026-09-15 Orcanos QMS (Ask Paul) seed from 005 becomes its
-- first run, and any resolution already entered becomes its first note, so
-- history starts complete rather than empty. Both guarded, safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists iso27001_audit_runs (
  id            uuid primary key default gen_random_uuid(),
  system_name   text not null,                          -- key from lib/iso27001-systems.ts
  framework     text not null default 'iso27001-2022',
  run_date      date not null,                          -- the ledger's `last_run`
  source        text not null default 'import',         -- seed | import
  imported_by   bigint,                                 -- master users.id, no FK
  imported_by_email text,
  control_count int not null default 0,
  summary       jsonb not null default '{}',            -- {"pass": n, "partial": n, ...}
  created_at    timestamptz not null default now()
);

create index if not exists idx_iso27001_audit_runs_system
  on iso27001_audit_runs(system_name, run_date desc, created_at desc);

create table if not exists iso27001_run_controls (
  run_id      uuid not null references iso27001_audit_runs(id) on delete cascade,
  control_id  text not null,
  title       text not null,
  theme       text not null,
  status      text not null,
  check_ids   jsonb not null default '[]',
  evidence    text,
  primary key (run_id, control_id)
);

create table if not exists iso27001_control_notes (
  id               uuid primary key default gen_random_uuid(),
  system_name      text not null,
  control_id       text not null,
  run_id           uuid references iso27001_audit_runs(id) on delete set null, -- the run that was current when this was written
  answer           text not null,
  evidence_link    text,
  asserted_status  text,                                -- pass|partial|fail|blocked|not_applicable, or null = as scanned
  resolved         boolean not null,
  author_id        bigint,                              -- master users.id, no FK
  author_email     text,
  created_at       timestamptz not null default now()
);

create index if not exists idx_iso27001_control_notes_control
  on iso27001_control_notes(system_name, control_id, created_at desc);

comment on table iso27001_audit_runs is
  'One imported compliance-audit skill run per system. Immutable. See sql/006_iso27001_history.sql.';
comment on table iso27001_run_controls is
  'Annex A control statuses as a given run saw them. Immutable snapshot.';
comment on table iso27001_control_notes is
  'Append-only history of operator answers/status on iso27001_controls.';

-- ── backfill: 005's seed becomes the first run ─────────────────────────────
do $$
declare
  v_run uuid;
begin
  if exists (select 1 from iso27001_controls where system_name = 'orcanos-qms')
     and not exists (select 1 from iso27001_audit_runs where system_name = 'orcanos-qms') then

    insert into iso27001_audit_runs (system_name, run_date, source, control_count, summary)
    select 'orcanos-qms',
           coalesce(max(last_checked), current_date),
           'seed',
           count(*),
           (select jsonb_object_agg(status, n)
              from (select status, count(*) n from iso27001_controls
                     where system_name = 'orcanos-qms' group by status) s)
      from iso27001_controls
     where system_name = 'orcanos-qms'
    returning id into v_run;

    insert into iso27001_run_controls (run_id, control_id, title, theme, status, check_ids, evidence)
    select v_run, control_id, title, theme, status, check_ids, evidence
      from iso27001_controls
     where system_name = 'orcanos-qms';

    insert into iso27001_control_notes
      (system_name, control_id, run_id, answer, evidence_link, asserted_status, resolved, author_id, created_at)
    select system_name, control_id, v_run, resolution_answer, resolution_evidence_link, resolved_status,
           resolved, resolved_by, coalesce(resolved_at, updated_at)
      from iso27001_controls
     where system_name = 'orcanos-qms' and resolution_answer is not null;
  end if;
end $$;

-- Rollback (destroys all run history and every note — export first):
-- drop table if exists iso27001_control_notes;
-- drop table if exists iso27001_run_controls;
-- drop table if exists iso27001_audit_runs;
