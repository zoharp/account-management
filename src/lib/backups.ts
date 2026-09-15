/**
 * Read-only backup/PITR status per Supabase project, via the Management API.
 *
 * Status-only by design (first cut of the disaster-recovery screen — see
 * `BackupsClient.tsx`). This never triggers a backup or a restore; it only
 * reports what Supabase already has. There is no logical-dump pipeline yet
 * (`Orcanos QMS/design/BACKUP_RECOVERY_PLAN.md` §2.2/§6) — this surfaces the
 * PITR/snapshot state that plan treats as the primary, zero-code backup
 * mechanism, so gaps (PITR off, or an unexpectedly old last backup) are
 * visible before anything is built on top of it.
 *
 * NOTE, same caveat as `lib/provisioning.ts`: the Management API's exact
 * response shape for this endpoint has not been verified against a live org.
 * Parsing here is deliberately tolerant — an unrecognised shape reports
 * `available: false` with the raw status rather than throwing.
 */

import { supabaseOrgAccessToken } from './env';

const MANAGEMENT_API = 'https://api.supabase.com/v1';

export interface BackupStatus {
  /** False when the Management API call itself failed (network, auth, 404 project). */
  available: boolean;
  /** Point-in-time recovery, Supabase's continuous WAL-based backup. */
  pitrEnabled: boolean;
  /** Most recent completed backup/snapshot timestamp, if any. */
  lastBackupAt: string | null;
  /** How many backups the API reported (physical + logical), for a sanity count. */
  backupCount: number;
  /** Set when `available` is false, or the call succeeded but the shape was unrecognised. */
  error: string | null;
}

function headers(): Record<string, string> {
  return { Authorization: `Bearer ${supabaseOrgAccessToken()}` };
}

/** One project's backup/PITR status. Never throws — failures are carried in the result. */
export async function fetchBackupStatus(projectRef: string): Promise<BackupStatus> {
  try {
    const res = await fetch(`${MANAGEMENT_API}/projects/${projectRef}/database/backups`, {
      headers: headers(),
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });

    if (!res.ok) {
      return {
        available: false,
        pitrEnabled: false,
        lastBackupAt: null,
        backupCount: 0,
        error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`,
      };
    }

    const body = (await res.json()) as Record<string, unknown>;
    const backups = Array.isArray(body.backups) ? (body.backups as Record<string, unknown>[]) : [];
    const completed = backups.filter(
      (b) => String(b.status ?? '').toUpperCase() === 'COMPLETED',
    );
    const timestamps = completed
      .map((b) => (b.inserted_at ?? b.insertedAt) as string | undefined)
      .filter((t): t is string => Boolean(t))
      .sort();

    return {
      available: true,
      pitrEnabled: Boolean(body.pitr_enabled ?? body.pitrEnabled),
      lastBackupAt: timestamps.length ? timestamps[timestamps.length - 1] : null,
      backupCount: completed.length,
      error: null,
    };
  } catch (e) {
    return {
      available: false,
      pitrEnabled: false,
      lastBackupAt: null,
      backupCount: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Pull the project ref out of a stored Supabase host URL
 * (`https://<ref>.supabase.co`). Returns null for anything else — a
 * self-hosted or non-Supabase `db_host` has no Management API status to show.
 */
export function projectRefFromHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const m = host.match(/^https?:\/\/([a-z0-9]+)\.supabase\.co\/?$/i);
  return m ? m[1] : null;
}
