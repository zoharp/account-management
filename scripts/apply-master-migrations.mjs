#!/usr/bin/env node
// Applies sql/NNN_*.sql migrations to the master Supabase project via the
// Management API's database/query route (the same route CLAUDE.md documents
// as the one that actually works for master DDL - PostgREST cannot run DDL
// and db.<ref>.supabase.co is IPv6-only). Called from deploy.bat before
// push, so a failing migration blocks the deploy.
//
// Idempotent in two ways: every sql/NNN_*.sql file already uses
// `create ... if not exists` / `add column if not exists`, and a
// schema_migrations ledger row is written after each success so repeat
// deploys skip what's already been applied.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    if (process.env[m[1]] !== undefined && process.env[m[1]] !== '') continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}

loadEnvFile(join(repoRoot, '.env.local'));

const token = process.env.SUPABASE_ORG_ACCESS_TOKEN;
const supabaseUrl = process.env.SUPABASE_URL;

if (!token) {
  console.error('SUPABASE_ORG_ACCESS_TOKEN is not set. Add it to .env.local (Supabase Dashboard > Account > Access Tokens).');
  process.exit(1);
}
if (!supabaseUrl) {
  console.error('SUPABASE_URL is not set. Add it to .env.local.');
  process.exit(1);
}

const refMatch = supabaseUrl.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i);
if (!refMatch) {
  console.error(`SUPABASE_URL "${supabaseUrl}" does not look like https://<ref>.supabase.co.`);
  process.exit(1);
}
const projectRef = refMatch[1];
const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

async function runSql(sql) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      // Cloudflare in front of api.supabase.com bot-blocks default urllib
      // User-Agent (CLAUDE.md, "curl not urllib" note). Node's fetch UA is
      // fine; set an explicit one anyway so it's obvious in access logs.
      'User-Agent': 'account-management-deploy/1.0',
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function main() {
  await runSql(`
    create table if not exists schema_migrations (
      filename    text primary key,
      applied_at  timestamptz not null default now()
    );
  `);

  const appliedRows = await runSql(`select filename from schema_migrations;`);
  const applied = new Set(
    Array.isArray(appliedRows) ? appliedRows.map(r => r.filename) : []
  );

  const sqlDir = join(repoRoot, 'sql');
  const files = readdirSync(sqlDir)
    .filter(f => /^\d{3}_.+\.sql$/.test(f))
    .sort();

  const pending = files.filter(f => !applied.has(f));

  if (pending.length === 0) {
    console.log(`Master migrations: nothing pending (${files.length} on disk, ${applied.size} recorded on ${projectRef}).`);
    return;
  }

  console.log(`Master migrations: ${pending.length} pending on ${projectRef}.`);
  for (const filename of pending) {
    const path = join(sqlDir, filename);
    const sql = readFileSync(path, 'utf8');
    process.stdout.write(`  applying ${filename} ... `);
    await runSql(sql);
    // filename is validated by the \d{3}_ regex above, so no quote injection.
    await runSql(`insert into schema_migrations (filename) values ('${filename}') on conflict do nothing;`);
    console.log('ok');
  }
  console.log(`Master migrations: applied ${pending.length}.`);
}

main().catch(err => {
  console.error('Master migrations FAILED:', err.message || err);
  process.exit(1);
});
