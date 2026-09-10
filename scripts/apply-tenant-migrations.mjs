#!/usr/bin/env node
// Applies sql/bootstrap_new_account.sql to every existing tenant's Supabase
// project, skipping tenants whose ledger says the current file's hash has
// already been applied. Same route as the master runner (Management API's
// database/query - the only route that works because PostgREST can't run
// DDL and db.<ref>.supabase.co is IPv6-only from Vercel/CI).
//
// The bootstrap file itself is idempotent (create ... if not exists, etc.),
// so re-applying is always safe; the per-tenant schema_migrations ledger
// exists only to skip the work when nothing has changed.
//
// A tenant that fails (paused project, missing ref, revoked key, etc.) is
// logged but does not stop the others. The script exits nonzero if any
// tenant errored, so a failing deploy.bat step surfaces it.

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
const masterUrl = process.env.SUPABASE_URL;
const masterKey = process.env.SUPABASE_SERVICE_KEY;

if (!token) {
  console.error('SUPABASE_ORG_ACCESS_TOKEN is not set — cannot reach the Management API.');
  process.exit(1);
}
if (!masterUrl || !masterKey) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY not set — cannot list accounts from master.');
  process.exit(1);
}

const HEADERS_MGMT = {
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json',
  'User-Agent': 'account-management-deploy/1.0',
};

async function managementQuery(projectRef, sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    { method: 'POST', headers: HEADERS_MGMT, body: JSON.stringify({ query: sql }) },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  try { return JSON.parse(text); } catch { return text; }
}

async function listAccounts() {
  const url = `${masterUrl.replace(/\/$/, '')}/rest/v1/accounts?select=id,account_name,vector_db_host,db_host,is_active`;
  const res = await fetch(url, {
    headers: {
      'apikey': masterKey,
      'Authorization': `Bearer ${masterKey}`,
      'Accept': 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`Master GET accounts HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// vector_db_host looks like "https://<ref>.supabase.co" (provisioning.ts:385);
// db_host looks like "db.<ref>.supabase.co" (provisioning.ts:351). Both hold
// the same project ref.
function projectRefFrom(account) {
  const candidates = [account.vector_db_host, account.db_host];
  for (const raw of candidates) {
    if (!raw) continue;
    const s = String(raw).trim();
    let m = s.match(/^https?:\/\/([a-z0-9]{20})\.supabase\.co/i);
    if (m) return m[1];
    m = s.match(/^db\.([a-z0-9]{20})\.supabase\.co/i);
    if (m) return m[1];
    m = s.match(/^([a-z0-9]{20})\.supabase\.co/i);
    if (m) return m[1];
  }
  return null;
}

async function main() {
  const bootstrapPath = join(repoRoot, 'sql', 'bootstrap_new_account.sql');
  const bootstrapSql = readFileSync(bootstrapPath, 'utf8');
  const bootstrapHash = createHash('sha256').update(bootstrapSql).digest('hex').slice(0, 16);
  const marker = `bootstrap_new_account:${bootstrapHash}`;

  const accounts = await listAccounts();
  console.log(`Tenant migrations: ${accounts.length} account(s), bootstrap hash ${bootstrapHash}.`);

  const skipped = [];
  const applied = [];
  const failed = [];

  for (const acc of accounts) {
    const ref = projectRefFrom(acc);
    const label = `${acc.account_name || acc.id}`;
    if (!ref) {
      skipped.push({ label, why: 'no supabase project host' });
      console.log(`  - ${label}: no supabase project host, skipped.`);
      continue;
    }
    try {
      await managementQuery(ref, `
        create table if not exists schema_migrations (
          filename    text primary key,
          applied_at  timestamptz not null default now()
        );
      `);
      const rows = await managementQuery(
        ref,
        `select 1 as ok from schema_migrations where filename = '${marker}' limit 1;`,
      );
      const alreadyApplied = Array.isArray(rows) && rows.length > 0;
      if (alreadyApplied) {
        skipped.push({ label, why: 'up-to-date' });
        console.log(`  = ${label} (${ref}): up-to-date.`);
        continue;
      }

      process.stdout.write(`  * ${label} (${ref}): applying bootstrap ... `);
      await managementQuery(ref, bootstrapSql);
      await managementQuery(
        ref,
        `insert into schema_migrations (filename) values ('${marker}') on conflict do nothing;`,
      );
      applied.push(label);
      console.log('ok');
    } catch (err) {
      failed.push({ label, ref, error: err.message || String(err) });
      console.log(`  ! ${label} (${ref}): FAILED — ${err.message || err}`);
    }
  }

  console.log(
    `Tenant migrations: applied=${applied.length} skipped=${skipped.length} failed=${failed.length}.`,
  );
  if (failed.length) {
    console.error('One or more tenants failed to migrate. Investigate before deploying:');
    for (const f of failed) console.error(`  - ${f.label} (${f.ref}): ${f.error}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Tenant migrations FAILED:', err.message || err);
  process.exit(1);
});
