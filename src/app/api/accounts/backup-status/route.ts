/**
 * GET /api/accounts/backup-status — PITR/backup status for every account's
 * Supabase project, plus the master project. Read-only; see `lib/backups.ts`
 * for why this never triggers a backup or a restore.
 */

import { requirePlatformStaff } from '@/lib/session';
import { pgGet } from '@/lib/supabase';
import { fetchBackupStatus, projectRefFromHost } from '@/lib/backups';
import { supabaseUrl } from '@/lib/env';
import type { AccountRow, BackupStatusRow } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Run at most this many Management API calls at once — one per Supabase project. */
const CONCURRENCY = 5;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function GET() {
  const { error } = await requirePlatformStaff();
  if (error) return error;

  const masterRef = projectRefFromHost(supabaseUrl());

  const accounts = await pgGet<AccountRow[]>(
    'accounts?select=id,account_name,region,vector_db_host&order=account_name.asc',
  );

  const targets: { key: string; account_name: string; is_master: boolean; region: AccountRow['region']; ref: string | null }[] = [
    { key: 'master', account_name: 'Platform (master)', is_master: true, region: null, ref: masterRef },
    ...accounts.map((a) => ({
      key: a.id,
      account_name: a.account_name,
      is_master: false,
      region: a.region ?? 'us',
      ref: projectRefFromHost(a.vector_db_host),
    })),
  ];

  const rows: BackupStatusRow[] = await mapWithConcurrency(targets, CONCURRENCY, async (t) => {
    if (!t.ref) {
      return {
        key: t.key,
        account_name: t.account_name,
        is_master: t.is_master,
        region: t.region ?? null,
        project_ref: null,
        has_project: false,
        available: false,
        pitr_enabled: false,
        last_backup_at: null,
        backup_count: 0,
        error: null,
      };
    }
    const status = await fetchBackupStatus(t.ref);
    return {
      key: t.key,
      account_name: t.account_name,
      is_master: t.is_master,
      region: t.region ?? null,
      project_ref: t.ref,
      has_project: true,
      available: status.available,
      pitr_enabled: status.pitrEnabled,
      last_backup_at: status.lastBackupAt,
      backup_count: status.backupCount,
      error: status.error,
    };
  });

  return Response.json({ rows });
}
