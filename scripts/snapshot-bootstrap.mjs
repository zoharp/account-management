#!/usr/bin/env node
/**
 * Regenerate `sql/bootstrap_new_account.sql` from the schema-master account's live database.
 *
 *   node --env-file=.env.local scripts/snapshot-bootstrap.mjs [--account orca60] [--out path]
 *
 * WHY. The bootstrap used to be a hand-kept copy of the QMS file, frozen on 2026-08-28. Every
 * per-account change after that (agents, proposals, 510(k), DHF, MDSAP — QMS `design/sql/010`–`041`)
 * reached the existing accounts through QMS's `scripts/run_missing_migrations.py` and never
 * reached this file, so a newly created account got a database without any of it.
 *
 * The rule now: **orca60 is the schema master.** Its database is the one every QMS migration is
 * applied to first, and its `schema_migrations` ledger says which. This script reads that
 * database through the Supabase Management API (`database/query`, the same route provisioning
 * uses) and writes the bootstrap from what is actually there:
 *
 *   - extensions, sequences, tables (columns, defaults, identity, generated columns, PK/unique/
 *     check constraints), foreign keys, indexes, functions, triggers, RLS flags, policies;
 *   - reference rows from REFERENCE_TABLES (standards, sections, questions, RAG settings, skills,
 *     510(k)/MDSAP settings) — never tenant content;
 *   - the master's `schema_migrations` rows, so QMS's runner treats a new database as being at
 *     the same migration as orca60 and applies only what comes after.
 *
 * Re-run it whenever a QMS per-account migration has been applied to orca60. Provisioning
 * compares a new database's ledger with orca60's after it is created and says so in the job
 * message when this file has fallen behind.
 *
 * Uses `curl`, not fetch: Cloudflare in front of api.supabase.com 403s (error 1010) some
 * non-browser User-Agents — see CLAUDE.md.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MASTER_REF = 'jjiavhexvfahboiodomv';

/** Leftovers or bookkeeping that a new database must not get as tables. */
const EXCLUDED_TABLE = (name) => /^v1_/.test(name); // pre-027 510(k) tables, renamed aside

/**
 * Tables whose rows are product configuration, copied verbatim. `reset` blanks columns that
 * would otherwise carry the master's own references into another tenant.
 * Deliberately absent: agent_definitions (QMS seeds them on first run from agent_catalog.py;
 * orca60's rows carry its own project ids and test agents), every document/chunk/conversation/
 * run/proposal/dossier table, sop_rules (extracted from orca60's own SOPs).
 */
const REFERENCE_TABLES = [
  { table: 'standards' },
  { table: 'standard_sections' },
  { table: 'predefined_questions' },
  { table: 'rag_settings' },
  { table: 'account_skills' },
  { table: 'account_section_keywords' },
  { table: 'settings_510k', reset: { default_repository_ids: [], fda_identifiers: {} } },
  { table: 'settings_mdsap' },
];

const args = process.argv.slice(2);
const argOf = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : dflt;
};
const ACCOUNT = argOf('--account', 'orca60');
const OUT = path.resolve(argOf('--out', path.join(ROOT, 'sql', 'bootstrap_new_account.sql')));

const TOKEN = process.env.SUPABASE_ORG_ACCESS_TOKEN;
if (!TOKEN) {
  console.error('SUPABASE_ORG_ACCESS_TOKEN is not set — run with --env-file=.env.local');
  process.exit(1);
}

function query(ref, sql) {
  const out = execFileSync(
    'curl',
    [
      '-s', '-X', 'POST',
      `https://api.supabase.com/v1/projects/${ref}/database/query`,
      '-H', `Authorization: Bearer ${TOKEN}`,
      '-H', 'Content-Type: application/json',
      '--data-binary', '@-',
    ],
    { input: JSON.stringify({ query: sql }), maxBuffer: 256 * 1024 * 1024 },
  ).toString('utf8');
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch {
    throw new Error(`Management API returned non-JSON: ${out.slice(0, 300)}`);
  }
  if (!Array.isArray(parsed)) throw new Error(`Query failed: ${out.slice(0, 500)}`);
  return parsed;
}

const qi = (ident) => (/^[a-z_][a-z0-9_]*$/.test(ident) ? ident : `"${ident.replace(/"/g, '""')}"`);
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

// ── Locate the master account's project ───────────────────────────────────────

const acct = query(
  MASTER_REF,
  `select vector_db_host from accounts where lower(account_name) = lower(${lit(ACCOUNT)})`,
)[0];
const ref = /^https:\/\/([a-z0-9]{20})\.supabase\.co/.exec(acct?.vector_db_host ?? '')?.[1];
if (!ref) throw new Error(`Account '${ACCOUNT}' has no Supabase vector_db_host in master`);
console.error(`Snapshotting ${ACCOUNT} (${ref})`);

// ── Catalog ───────────────────────────────────────────────────────────────────

const PUBLIC_TABLES = `
  select c.oid, c.relname from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p')
    and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')`;

const [cat] = query(ref, `
with t as (${PUBLIC_TABLES})
select json_build_object(
  'tables', (select json_agg(json_build_object('name', relname, 'rls', relrowsecurity, 'force', relforcerowsecurity) order by relname)
             from pg_class where oid in (select oid from t)),
  'columns', (select json_agg(json_build_object(
                't', c.relname, 'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
                'notnull', a.attnotnull, 'default', pg_get_expr(ad.adbin, ad.adrelid),
                'identity', a.attidentity, 'generated', a.attgenerated) order by c.relname, a.attnum)
              from t c join pg_attribute a on a.attrelid = c.oid
              left join pg_attrdef ad on ad.adrelid = c.oid and ad.adnum = a.attnum
              where a.attnum > 0 and not a.attisdropped),
  'constraints', (select json_agg(json_build_object(
                't', c.relname, 'name', k.conname, 'type', k.contype, 'def', pg_get_constraintdef(k.oid))
                order by c.relname, k.contype, k.conname)
              from t c join pg_constraint k on k.conrelid = c.oid where k.contype in ('p','u','c','f','x')),
  'indexes', (select json_agg(json_build_object('t', c.relname, 'name', i.relname, 'def', pg_get_indexdef(i.oid)) order by c.relname, i.relname)
              from t c join pg_index x on x.indrelid = c.oid join pg_class i on i.oid = x.indexrelid
              where not exists (select 1 from pg_constraint k where k.conindid = i.oid and k.contype in ('p','u','x'))),
  'sequences', (select json_agg(json_build_object(
                'name', s.relname, 'type', format_type(q.seqtypid, null), 'start', q.seqstart, 'inc', q.seqincrement,
                'owner_t', ot.relname, 'owner_c', oa.attname, 'identity', d.deptype = 'i') order by s.relname)
              from pg_class s join pg_sequence q on q.seqrelid = s.oid
              left join pg_depend d on d.objid = s.oid and d.classid = 'pg_class'::regclass and d.refclassid = 'pg_class'::regclass and d.deptype in ('a','i')
              left join pg_class ot on ot.oid = d.refobjid
              left join pg_attribute oa on oa.attrelid = d.refobjid and oa.attnum = d.refobjsubid
              where s.relnamespace = 'public'::regnamespace and s.relkind = 'S'),
  'functions', (select json_agg(json_build_object('name', p.proname, 'def', pg_get_functiondef(p.oid)) order by p.proname, p.oid)
              from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p')
                and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
  'triggers', (select json_agg(json_build_object('t', c.relname, 'name', g.tgname, 'def', pg_get_triggerdef(g.oid)) order by c.relname, g.tgname)
              from t c join pg_trigger g on g.tgrelid = c.oid where not g.tgisinternal),
  'policies', (select json_agg(json_build_object('t', tablename, 'name', policyname, 'permissive', permissive,
                'roles', roles, 'cmd', cmd, 'qual', qual, 'check', with_check) order by tablename, policyname)
              from pg_policies where schemaname = 'public'),
  'views', (select json_agg(relname) from pg_class where relnamespace = 'public'::regnamespace and relkind in ('v','m')),
  'types', (select json_agg(typname) from pg_type t where typnamespace = 'public'::regnamespace and typtype in ('e','d','c')
              and not exists (select 1 from pg_class c where c.reltype = t.oid)
              and not exists (select 1 from pg_depend d where d.objid = t.oid and d.deptype = 'e')),
  'extensions', (select json_agg(json_build_object('name', extname, 'schema', extnamespace::regnamespace::text) order by extname) from pg_extension),
  'migrations', (select json_agg(filename order by filename) from schema_migrations)
) as cat`);

const C = cat.cat;
const by = (rows, key) => (rows ?? []).reduce((m, r) => ((m[r[key]] ??= []).push(r), m), {});

// Objects the generator does not emit. Refuse rather than write a bootstrap that silently lacks them.
if (C.views?.length) throw new Error(`Views are not supported by this generator: ${C.views.join(', ')}`);
if (C.types?.length) throw new Error(`Custom types are not supported by this generator: ${C.types.join(', ')}`);

const tables = C.tables.filter((t) => !EXCLUDED_TABLE(t.name));
const tableNames = new Set(tables.map((t) => t.name));
const cols = by(C.columns, 't');
const cons = by(C.constraints, 't');
const idx = by(C.indexes, 't');
const trig = by(C.triggers, 't');
const pols = by(C.policies, 't');

// ── DDL ───────────────────────────────────────────────────────────────────────

const out = [];
const emit = (s = '') => out.push(s);
const section = (title) => emit(`\n-- ${'─'.repeat(3)} ${title} ${'─'.repeat(Math.max(3, 72 - title.length))}\n`);

emit(`-- ═════════════════════════════════════════════════════════════════════════════
-- bootstrap_new_account.sql — GENERATED, do not edit by hand.
--
-- Snapshot of the schema-master account '${ACCOUNT}' (Supabase ${ref}), taken
-- ${new Date().toISOString()} by scripts/snapshot-bootstrap.mjs.
-- At migration: ${C.migrations?.at(-1) ?? '(none)'} (${C.migrations?.length ?? 0} rows in schema_migrations).
--
-- Run once by provisioning (lib/provisioning.ts → running_schema) against a brand
-- new tenant project through the Management API. Idempotent: every object is
-- if-not-exists / or-replace and every row is on-conflict-do-nothing, so a resumed
-- job can run it again.
--
-- To change the per-account schema: add a numbered migration in Orcanos QMS
-- design/sql/, apply it (scripts/run_missing_migrations.py), then regenerate this.
-- ═════════════════════════════════════════════════════════════════════════════`);

section('Extensions');
// Supabase installs uuid-ossp/pgcrypto into `extensions` and vector/pg_trgm into `public` on
// every new project; mirror exactly what the master has, skipping the platform's own.
const PLATFORM_EXT = new Set(['plpgsql', 'pg_stat_statements', 'supabase_vault', 'pg_graphql', 'pgsodium']);
for (const e of C.extensions.filter((e) => !PLATFORM_EXT.has(e.name))) {
  emit(`create extension if not exists ${qi(e.name)} with schema ${qi(e.schema)};`);
}

section('Sequences');
const seqs = (C.sequences ?? []).filter((s) => !s.identity && (!s.owner_t || tableNames.has(s.owner_t)));
for (const s of seqs) {
  emit(`create sequence if not exists public.${qi(s.name)} as ${s.type} start with ${s.start} increment by ${s.inc};`);
}

section('Tables');
for (const t of tables) {
  const lines = [];
  for (const c of cols[t.name] ?? []) {
    let l = `  ${qi(c.name)} ${c.type}`;
    if (c.generated === 's') l += ` generated always as (${c.default}) stored`;
    else if (c.identity === 'a') l += ' generated always as identity';
    else if (c.identity === 'd') l += ' generated by default as identity';
    else if (c.default != null) l += ` default ${c.default}`;
    if (c.notnull && !c.identity) l += ' not null';
    lines.push(l);
  }
  for (const k of (cons[t.name] ?? []).filter((k) => k.type !== 'f')) {
    lines.push(`  constraint ${qi(k.name)} ${k.def}`);
  }
  emit(`create table if not exists public.${qi(t.name)} (\n${lines.join(',\n')}\n);`);
}

section('Sequence ownership');
for (const s of seqs.filter((s) => s.owner_t)) {
  emit(`alter sequence public.${qi(s.name)} owned by public.${qi(s.owner_t)}.${qi(s.owner_c)};`);
}

section('Foreign keys');
// Added after every table exists, so declaration order never matters. Guarded because
// `add constraint` has no if-not-exists.
for (const t of tables) {
  for (const k of (cons[t.name] ?? []).filter((k) => k.type === 'f')) {
    emit(`do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = ${lit(k.name)} and conrelid = 'public.${qi(t.name)}'::regclass) then
    alter table public.${qi(t.name)} add constraint ${qi(k.name)} ${k.def};
  end if;
end $fk$;`);
  }
}

section('Indexes');
for (const t of tables) {
  for (const i of idx[t.name] ?? []) {
    emit(i.def.replace(/^CREATE (UNIQUE )?INDEX /, (_m, u) => `CREATE ${u ?? ''}INDEX IF NOT EXISTS `) + ';');
  }
}

section('Functions');
for (const f of C.functions ?? []) {
  emit(f.def.trimEnd() + ';\n');
}

section('Triggers');
for (const t of tables) {
  for (const g of trig[t.name] ?? []) {
    emit(`drop trigger if exists ${qi(g.name)} on public.${qi(t.name)};`);
    emit(g.def + ';');
  }
}

section('Row level security');
for (const t of tables) {
  if (t.rls) emit(`alter table public.${qi(t.name)} enable row level security;`);
  if (t.force) emit(`alter table public.${qi(t.name)} force row level security;`);
}
for (const t of tables) {
  for (const p of pols[t.name] ?? []) {
    const roles = (Array.isArray(p.roles) ? p.roles : String(p.roles).replace(/[{}]/g, '').split(',')).join(', ');
    emit(`drop policy if exists ${qi(p.name)} on public.${qi(t.name)};`);
    emit(
      `create policy ${qi(p.name)} on public.${qi(t.name)} as ${p.permissive.toLowerCase()} for ${p.cmd.toLowerCase()} to ${roles}` +
        (p.qual ? ` using (${p.qual})` : '') +
        (p.check ? ` with check (${p.check})` : '') +
        ';',
    );
  }
}

// ── Reference rows ────────────────────────────────────────────────────────────

section('Reference data');
for (const { table, reset } of REFERENCE_TABLES) {
  if (!tableNames.has(table)) throw new Error(`Reference table '${table}' does not exist in ${ACCOUNT}`);
  const insertable = (cols[table] ?? []).filter((c) => c.generated !== 's');
  const [{ rows }] = query(ref, `select coalesce(json_agg(t), '[]') as rows from public.${qi(table)} t`);
  if (!rows.length) {
    emit(`-- ${table}: no rows in ${ACCOUNT}`);
    continue;
  }
  const data = reset ? rows.map((r) => ({ ...r, ...reset })) : rows;
  const json = JSON.stringify(data);
  if (json.includes('$ref$')) throw new Error(`Row data in ${table} contains the dollar-quote tag`);
  const list = insertable.map((c) => qi(c.name)).join(', ');
  const overriding = insertable.some((c) => c.identity === 'a') ? ' overriding system value' : '';
  emit(`-- ${table}: ${rows.length} row(s)`);
  emit(
    `insert into public.${qi(table)} (${list})${overriding}\n` +
      `select ${list} from jsonb_populate_recordset(null::public.${qi(table)}, $ref$${json}$ref$::jsonb)\n` +
      `on conflict do nothing;`,
  );
  // Rows arrive with their ids, so move any id sequence past them.
  for (const c of insertable) {
    const usesSeq = c.identity || /^nextval\(/.test(c.default ?? '');
    if (usesSeq) {
      emit(
        `select setval(pg_get_serial_sequence('public.${qi(table)}', ${lit(c.name)}), ` +
          `greatest((select max(${qi(c.name)}) from public.${qi(table)}), 1));`,
      );
    }
  }
}

// ── Migration ledger ──────────────────────────────────────────────────────────

section('Migration ledger');
if (!tableNames.has('schema_migrations')) throw new Error(`${ACCOUNT} has no schema_migrations table`);
if (C.migrations?.length) {
  emit(`insert into public.schema_migrations (filename) values\n` +
    C.migrations.map((f) => `  (${lit(f)})`).join(',\n') + `\non conflict do nothing;`);
}

writeFileSync(OUT, out.join('\n') + '\n', 'utf8');
console.error(
  `Wrote ${path.relative(process.cwd(), OUT)}: ${tables.length} tables, ${C.functions?.length ?? 0} functions, ` +
    `${C.migrations?.length ?? 0} ledger rows (latest ${C.migrations?.at(-1)})`,
);
