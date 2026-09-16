'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Iso27001ControlRow, Iso27001Status, Iso27001Theme } from '@/lib/types';
import { ISO27001_SYSTEMS, DEFAULT_ISO27001_SYSTEM } from '@/lib/iso27001-systems';
import ResolveControlModal from './ResolveControlModal';

/**
 * ISO 27001 Annex A control status — one row per control, seeded from the
 * `compliance-audit` Claude skill's ledger (see `sql/005_iso27001_controls.sql`).
 *
 * Read-only against the automated `status`; the only write this screen makes
 * is a "resolve" — an operator's answer to a control a scan can't settle on
 * its own, via `ResolveControlModal`. Follows the same load()/useEffect and
 * table-with-a-name-link-to-open-a-modal idiom as `AccountsClient`/`BackupsClient`.
 */

const THEMES: readonly Iso27001Theme[] = ['Organizational', 'People', 'Physical', 'Technological'];
const STATUSES: readonly Iso27001Status[] = ['pass', 'partial', 'fail', 'blocked', 'not_applicable'];

const STATUS_LABEL: Record<Iso27001Status, string> = {
  pass: 'Compliant',
  partial: 'Partial',
  fail: 'Gap',
  blocked: 'Blocked',
  not_applicable: 'N/A',
};

const STATUS_TOGGLE: Record<Iso27001Status, string> = {
  pass: 'acl-toggle--on',
  partial: 'acl-toggle--warn',
  fail: 'acl-toggle--err',
  blocked: 'acl-toggle--off',
  not_applicable: 'acl-toggle--off',
};

function StatusPill({ status }: { status: Iso27001Status }) {
  return <span className={`acl-toggle ${STATUS_TOGGLE[status]}`}>{STATUS_LABEL[status]}</span>;
}

export default function Iso27001Client() {
  const [system] = useState(DEFAULT_ISO27001_SYSTEM);
  const [rows, setRows] = useState<Iso27001ControlRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const [themeFilter, setThemeFilter] = useState<'all' | Iso27001Theme>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | Iso27001Status>('all');
  const [showResolvedOnly, setShowResolvedOnly] = useState<'all' | 'open' | 'resolved'>('all');

  const [resolving, setResolving] = useState<Iso27001ControlRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/iso27001?system=${encodeURIComponent(system)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { controls: Iso27001ControlRow[] };
      setRows(data.controls ?? []);
      setLoadedAt(new Date());
    } catch (e) {
      setError(`Could not load ISO 27001 controls: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  }, [system]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () =>
      rows
        .filter((r) => themeFilter === 'all' || r.theme === themeFilter)
        .filter((r) => statusFilter === 'all' || r.status === statusFilter)
        .filter((r) => showResolvedOnly === 'all' || (showResolvedOnly === 'resolved') === r.resolved),
    [rows, themeFilter, statusFilter, showResolvedOnly],
  );

  const applicable = rows.filter((r) => r.status !== 'not_applicable');
  const compliant = applicable.filter((r) => r.status === 'pass').length;
  const openGaps = rows.filter((r) => r.status === 'fail' && !r.resolved).length;
  const resolvedCount = rows.filter((r) => r.resolved).length;
  const systemLabel = ISO27001_SYSTEMS.find((s) => s.key === system)?.label ?? system;

  return (
    <>
      <div className="app-page-header">
        <div>
          <h1>ISO 27001 audit</h1>
          <p className="app-page-sub">
            Annex A control status for {systemLabel}, from the last `compliance-audit` skill run.
            Automated findings are read-only here — resolve a control to add your own answer and
            evidence link without waiting for the next scan.
          </p>
        </div>
      </div>

      <div className="app-card">
        <div className="acl-toolbar">
          <div className="acl-muted">
            {loadedAt ? `Loaded ${loadedAt.toLocaleTimeString()} · ` : ''}
            {!loading && !error && (
              <>
                {applicable.length ? Math.round((100 * compliant) / applicable.length) : 0}% compliant
                {' · '}
                {openGaps} open gap{openGaps === 1 ? '' : 's'}
                {' · '}
                {resolvedCount} of {rows.length} resolved
              </>
            )}
          </div>
          <button className="acl-btn-cancel" onClick={() => void load()} disabled={loading}>
            {loading ? 'Loading…' : '↺ Refresh'}
          </button>
        </div>

        <div className="acl-toolbar" style={{ borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <select
              className="acl-input"
              value={themeFilter}
              onChange={(e) => setThemeFilter(e.target.value as typeof themeFilter)}
              style={{ width: 'auto' }}
            >
              <option value="all">All themes</option>
              {THEMES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              className="acl-input"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              style={{ width: 'auto' }}
            >
              <option value="all">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <select
              className="acl-input"
              value={showResolvedOnly}
              onChange={(e) => setShowResolvedOnly(e.target.value as typeof showResolvedOnly)}
              style={{ width: 'auto' }}
            >
              <option value="all">Resolved + open</option>
              <option value="open">Open only</option>
              <option value="resolved">Resolved only</option>
            </select>
          </div>
        </div>

        {error ? (
          <div style={{ padding: 20 }}>
            <div className="acl-error" style={{ marginBottom: 0 }}>
              {error}
            </div>
          </div>
        ) : loading && rows.length === 0 ? (
          <p className="acl-empty">Loading control statuses…</p>
        ) : filtered.length === 0 ? (
          <p className="acl-empty">No controls match the current filters.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="acl-table">
              <thead>
                <tr>
                  <th>Control</th>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Resolution</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id} className="acl-row">
                    <td className="acl-tenant">{row.control_id}</td>
                    <td>
                      <button className="acl-name-link" onClick={() => setResolving(row)}>
                        {row.title}
                      </button>
                    </td>
                    <td>
                      <StatusPill status={row.status} />
                    </td>
                    <td>
                      {row.resolved ? (
                        <span className="acl-toggle acl-toggle--on">Resolved</span>
                      ) : (
                        <span className="acl-muted">Open</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {resolving && (
        <ResolveControlModal
          control={resolving}
          onClose={() => setResolving(null)}
          onResolved={(updated) => {
            setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
            setResolving(null);
          }}
        />
      )}
    </>
  );
}
