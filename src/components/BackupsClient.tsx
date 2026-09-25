'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
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

type Issue = 'no_database' | 'check_failed' | 'pitr_off' | 'no_backup' | 'stale';

/** Which rule in `verdictFor` fired. Kept beside it so the two cannot drift. */
function issueFor(row: BackupStatusRow): Issue | null {
  if (!row.has_project) return 'no_database';
  if (!row.available) return 'check_failed';
  if (!row.pitr_enabled) return 'pitr_off';
  if (!row.last_backup_at) return 'no_backup';
  if (hoursAgo(row.last_backup_at) > STALE_HOURS) return 'stale';
  return null;
}

interface Advice {
  title: string;
  risk: string;
  actions: string[];
}

/**
 * What each issue means and what to do about it. The runbooks behind these
 * steps are `docs/compliance/DISASTER_RECOVERY.md` §5 and the to-do list in §9.
 */
const ADVICE: Record<Issue, Advice> = {
  pitr_off: {
    title: 'Point-in-time recovery is off',
    risk:
      'The database can only be restored to its last daily snapshot, so up to about 24 hours of changes can be lost. ' +
      'Snapshots are kept for about 7 days, restore only into the same project, and disappear if the project itself is deleted.',
    actions: [
      'Turn on PITR in the Supabase dashboard: Project Settings → Add-ons → Point in time recovery. It is a paid add-on and needs at least the Small compute size.',
      'Do the master project first. It holds every account, user and encrypted credential, so it is the one loss that affects all customers.',
      'For demo or low-value tenants, you can accept daily snapshots instead. Record that decision in DISASTER_RECOVERY.md §4 so the red status is a known risk, not a surprise.',
      'Either way, add a nightly database dump to storage outside Supabase (DR plan §9, item 4). That is the only copy that survives the project being deleted.',
    ],
  },
  stale: {
    title: `No backup in the last ${STALE_HOURS} hours`,
    risk: 'Backups seem to have stopped, and the amount of data a restore would lose grows every hour until they resume.',
    actions: [
      'Check in the Supabase dashboard that the project is not paused or being restored.',
      'Check status.supabase.com for an incident in the project’s region.',
      'If neither explains it, open a Supabase support ticket and quote the project ref.',
      'Until backups resume, take a manual dump (pg_dump) and keep it outside Supabase.',
    ],
  },
  no_backup: {
    title: 'PITR is on, but no backup has completed',
    risk:
      'There is nothing to restore from yet. If PITR was just turned on, this is expected for the first day; otherwise backups are failing.',
    actions: [
      'If PITR was turned on in the last 24 hours, wait and refresh tomorrow.',
      'Otherwise, open a Supabase support ticket and quote the project ref.',
      'Take a manual dump (pg_dump) now so a copy exists in the meantime.',
    ],
  },
  check_failed: {
    title: 'Backup status could not be read',
    risk:
      'This does not mean the data is at risk, only that its protection could not be confirmed. A 404 is the exception: it can mean the project no longer exists.',
    actions: [
      'Refresh. A timeout is often a one-off.',
      'HTTP 401 or 403: SUPABASE_ORG_ACCESS_TOKEN in Vercel has expired or lacks access to this project. Issue a new one in the Supabase dashboard.',
      'HTTP 404: check that the project still exists in the Supabase dashboard. If it has been deleted, treat it as an incident and follow DR plan §5.4.',
    ],
  },
  no_database: {
    title: 'No Supabase database',
    risk:
      'There is nothing in Supabase to back up for this account. That is fine if the account does not use Ask Paul. If the database is self-hosted, its backups are the host’s responsibility and are not checked here.',
    actions: [
      'If the account should have Ask Paul, provision its database from the account page.',
      'Otherwise, no action is needed.',
    ],
  },
};

function AdviceBody({ advice, isMaster }: { advice: Advice; isMaster?: boolean }) {
  return (
    <div className="dr-advice-body">
      <p>
        <strong>Risk: </strong>
        {advice.risk}
        {isMaster ? ' This is the master project, so the risk applies to the whole platform.' : ''}
      </p>
      <p className="dr-advice-label">What you can do</p>
      <ol>
        {advice.actions.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ol>
    </div>
  );
}

/** Most serious first — the order of the "What needs attention" panel. */
const ISSUE_ORDER: Issue[] = ['pitr_off', 'stale', 'no_backup', 'check_failed'];

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

  const [openKey, setOpenKey] = useState<string | null>(null);

  const atRisk = rows.filter((r) => r.has_project && verdictFor(r) !== 'ok');

  // One entry per problem, listing the projects it affects.
  const issueGroups = ISSUE_ORDER.map((issue) => ({
    issue,
    rows: atRisk.filter((r) => issueFor(r) === issue),
  })).filter((g) => g.rows.length > 0);

  return (
    <>
      <div className="app-page-header">
        <div>
          <h1>Disaster recovery</h1>
          <p className="app-page-sub">
            Point-in-time recovery status per Supabase project, read live from Supabase.
            Status only — nothing here triggers a backup or a restore. Click a row that needs
            attention to see the risk and what to do.
          </p>
        </div>
      </div>

      {!loading && !error && issueGroups.length > 0 && (
        <div className="app-card dr-attention">
          <h2 className="acl-section-title">What needs attention</h2>
          {issueGroups.map(({ issue, rows: affected }) => (
            <div key={issue} className="dr-issue">
              <div className="dr-issue-head">
                <Pill verdict={issue === 'pitr_off' || issue === 'check_failed' ? 'err' : 'warn'}>
                  {ADVICE[issue].title}
                </Pill>
                <span className="acl-muted">
                  {affected.map((r) => (r.is_master ? `${r.account_name} (master)` : r.account_name)).join(', ')}
                </span>
              </div>
              <AdviceBody advice={ADVICE[issue]} isMaster={affected.some((r) => r.is_master)} />
            </div>
          ))}
          <p className="acl-hint">
            Not covered by this screen: Traceability backups (Litestream and Fly snapshots — check them with{' '}
            <code>fly</code>), and escrow of <code>ENCRYPTION_KEY</code>. Losing that key makes every stored
            credential unreadable. See DISASTER_RECOVERY.md §3.2 and §6.3.
          </p>
        </div>
      )}

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
                  const issue = issueFor(row);
                  const open = openKey === row.key;
                  return (
                    <Fragment key={row.key}>
                    <tr
                      className={issue ? 'acl-row' : undefined}
                      onClick={issue ? () => setOpenKey(open ? null : row.key) : undefined}
                      title={issue ? 'Show the risk and what to do' : undefined}
                    >
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
                        {issue ? <span className="dr-caret">{open ? '▾' : '▸'}</span> : null}
                      </td>
                    </tr>
                    {open && issue ? (
                      <tr className="dr-advice-row">
                        <td colSpan={6}>
                          <p className="dr-advice-title">{ADVICE[issue].title}</p>
                          <AdviceBody advice={ADVICE[issue]} isMaster={row.is_master} />
                        </td>
                      </tr>
                    ) : null}
                    </Fragment>
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
