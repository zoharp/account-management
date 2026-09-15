'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BackupStatusRow } from '@/lib/types';

/**
 * Disaster recovery — status only, for now.
 *
 * This reads Supabase's own PITR/backup state per project through the
 * Management API; it never triggers a backup or a restore. There is no
 * backup pipeline of our own yet (`Orcanos QMS/design/BACKUP_RECOVERY_PLAN.md`)
 * — this screen exists so a gap (PITR off, or a stale/missing backup) is
 * visible before anything is built to act on it. A restore control is a
 * separate, deliberately later piece of work: it is destructive and needs its
 * own confirmation flow once there is a real restore path to drive.
 */

/** A backup older than this reads as stale even though one exists. */
const STALE_HOURS = 26;

function hoursAgo(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

type Verdict = 'ok' | 'warn' | 'err';

function verdictFor(row: BackupStatusRow): Verdict {
  if (!row.has_project) return 'warn'; // no database at all — nothing to back up, but worth seeing
  if (!row.available) return 'err'; // Management API call failed
  if (!row.pitr_enabled) return 'err'; // no continuous recovery configured
  if (!row.last_backup_at) return 'warn'; // PITR on, but no completed backup ever recorded
  if (hoursAgo(row.last_backup_at) > STALE_HOURS) return 'warn';
  return 'ok';
}

function Pill({ verdict, children }: { verdict: Verdict; children: React.ReactNode }) {
  const cls = verdict === 'ok' ? 'acl-toggle--on' : verdict === 'warn' ? 'acl-toggle--warn' : 'acl-toggle--err';
  return <span className={`acl-toggle ${cls}`}>{children}</span>;
}

export default function BackupsClient() {
  const [rows, setRows] = useState<BackupStatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/accounts/backup-status', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { rows: BackupStatusRow[] };
      setRows(data.rows ?? []);
      setLoadedAt(new Date());
    } catch (e) {
      setError(`Could not load backup status: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const atRisk = rows.filter((r) => r.has_project && verdictFor(r) !== 'ok');

  return (
    <>
      <div className="app-page-header">
        <div>
          <h1>Disaster recovery</h1>
          <p className="app-page-sub">
            Point-in-time recovery status per Supabase project, read live from Supabase.
            Status only — nothing here triggers a backup or a restore.
          </p>
        </div>
      </div>

      <div className="app-card">
        <div className="acl-toolbar">
          <div className="acl-muted">
            {loadedAt ? `Checked ${loadedAt.toLocaleTimeString()}` : ''}
            {!loading && !error && (
              <>
                {loadedAt ? ' · ' : ''}
                {atRisk.length === 0
                  ? 'All projects look healthy.'
                  : `${atRisk.length} project${atRisk.length === 1 ? '' : 's'} need attention.`}
              </>
            )}
          </div>
          <button className="acl-btn-cancel" onClick={() => void load()} disabled={loading}>
            {loading ? 'Checking…' : '↺ Refresh'}
          </button>
        </div>

        {error ? (
          <div style={{ padding: 20 }}>
            <div className="acl-error" style={{ marginBottom: 0 }}>
              {error}
            </div>
          </div>
        ) : loading && rows.length === 0 ? (
          <p className="acl-empty">Checking every project against Supabase…</p>
        ) : rows.length === 0 ? (
          <p className="acl-empty">No accounts found.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="acl-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Region</th>
                  <th>Project ref</th>
                  <th>PITR</th>
                  <th>Last backup</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const v = verdictFor(row);
                  return (
                    <tr key={row.key}>
                      <td>
                        {row.is_master ? <span className="acl-badge">MASTER</span> : null}{' '}
                        {row.account_name}
                      </td>
                      <td>
                        {row.region ? <span className="acl-badge acl-badge--region">{row.region}</span> : '—'}
                      </td>
                      <td className="acl-tenant">{row.project_ref ?? '—'}</td>
                      <td>
                        {!row.has_project ? (
                          <span className="acl-muted">no database</span>
                        ) : row.available ? (
                          <Pill verdict={row.pitr_enabled ? 'ok' : 'err'}>
                            {row.pitr_enabled ? 'Enabled' : 'Off'}
                          </Pill>
                        ) : (
                          <span className="acl-muted">unknown</span>
                        )}
                      </td>
                      <td className="acl-muted">
                        {row.last_backup_at
                          ? new Date(row.last_backup_at).toLocaleString()
                          : row.has_project && row.available
                            ? 'never'
                            : '—'}
                        {row.backup_count > 0 ? ` (${row.backup_count} total)` : ''}
                      </td>
                      <td>
                        {!row.has_project ? (
                          <Pill verdict="warn">No database</Pill>
                        ) : !row.available ? (
                          <Pill verdict="err" >{row.error ? row.error.slice(0, 60) : 'Check failed'}</Pill>
                        ) : (
                          <Pill verdict={v}>{v === 'ok' ? 'Healthy' : v === 'warn' ? 'Stale' : 'At risk'}</Pill>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
