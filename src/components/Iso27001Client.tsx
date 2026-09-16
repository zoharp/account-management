'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Iso27001AuditRun,
  Iso27001ControlRow,
  Iso27001RunControl,
  Iso27001Status,
  Iso27001Theme,
} from '@/lib/types';
import { ISO27001_SYSTEMS, DEFAULT_ISO27001_SYSTEM } from '@/lib/iso27001-systems';
import ResolveControlModal from './ResolveControlModal';

/**
 * ISO 27001 Annex A control status per audited system (Ask Paul, Traceability).
 *
 * Two views over the same screen:
 *  - **Current** — `iso27001_controls`: the newest run's automated status plus
 *    the operator's latest answer. The only view you can answer from.
 *  - **A saved run** — that run's immutable snapshot (sql/006), read-only.
 * Either way each row shows what changed against the run before it.
 *
 * New runs arrive by importing the `compliance-audit` skill's `ledger.json`
 * (the *Import run* button). Follows the load()/useEffect and
 * name-link-opens-a-modal idiom of `AccountsClient`/`BackupsClient`.
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

const CURRENT = 'current';

function StatusPill({ status }: { status: Iso27001Status }) {
  return <span className={`acl-toggle ${STATUS_TOGGLE[status]}`}>{STATUS_LABEL[status]}</span>;
}

function runLabel(run: Iso27001AuditRun): string {
  const s = run.summary ?? {};
  const applicable = run.control_count - (s.not_applicable ?? 0);
  const pct = applicable ? Math.round((100 * (s.pass ?? 0)) / applicable) : 0;
  return `${run.run_date} · ${pct}% compliant${run.source === 'seed' ? ' · initial' : ''}`;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  const data = (await res.json().catch(() => ({}))) as T & { detail?: string };
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
  return data;
}

/** One table row, whichever view it came from. */
type ViewRow = Iso27001RunControl & { current?: Iso27001ControlRow };

export default function Iso27001Client() {
  const [system, setSystem] = useState(DEFAULT_ISO27001_SYSTEM);
  const [runs, setRuns] = useState<Iso27001AuditRun[]>([]);
  const [runsError, setRunsError] = useState('');
  const [selectedRun, setSelectedRun] = useState<string>(CURRENT);

  const [current, setCurrent] = useState<Iso27001ControlRow[]>([]);
  const [snapshot, setSnapshot] = useState<Iso27001RunControl[]>([]);
  const [previous, setPrevious] = useState<Map<string, Iso27001Status>>(new Map());

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const [themeFilter, setThemeFilter] = useState<'all' | Iso27001Theme>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | Iso27001Status>('all');
  const [resolvedFilter, setResolvedFilter] = useState<'all' | 'open' | 'resolved' | 'changed'>('all');

  const [opened, setOpened] = useState<ViewRow | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const q = encodeURIComponent(system);

    // Runs come from sql/006. If it isn't applied the current view still works.
    let runList: Iso27001AuditRun[] = [];
    try {
      runList = (await getJson<{ runs: Iso27001AuditRun[] }>(`/api/iso27001/runs?system=${q}`)).runs ?? [];
      setRunsError('');
    } catch (e) {
      setRunsError(`Run history unavailable: ${e instanceof Error ? e.message : String(e)}`);
    }
    setRuns(runList);

    try {
      const cur = await getJson<{ controls: Iso27001ControlRow[] }>(`/api/iso27001?system=${q}`);
      setCurrent(cur.controls ?? []);

      const idx = selectedRun === CURRENT ? 0 : runList.findIndex((r) => r.id === selectedRun);
      if (selectedRun !== CURRENT && idx >= 0) {
        const snap = await getJson<{ controls: Iso27001RunControl[] }>(`/api/iso27001/runs/${runList[idx].id}`);
        setSnapshot(snap.controls ?? []);
      } else {
        setSnapshot([]);
      }

      const prevRun = idx >= 0 ? runList[idx + 1] : undefined;
      if (prevRun) {
        const prev = await getJson<{ controls: Iso27001RunControl[] }>(`/api/iso27001/runs/${prevRun.id}`);
        setPrevious(new Map((prev.controls ?? []).map((c) => [c.control_id, c.status])));
      } else {
        setPrevious(new Map());
      }
      setLoadedAt(new Date());
    } catch (e) {
      setError(`Could not load ISO 27001 controls: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  }, [system, selectedRun]);

  useEffect(() => {
    void load();
  }, [load]);

  const viewingPast = selectedRun !== CURRENT;
  const currentById = useMemo(() => new Map(current.map((c) => [c.control_id, c])), [current]);

  const rows: ViewRow[] = useMemo(
    () =>
      viewingPast
        ? snapshot.map((s) => ({ ...s, current: currentById.get(s.control_id) }))
        : current.map((c) => ({ ...c, run_id: '', current: c })),
    [viewingPast, snapshot, current, currentById],
  );

  const filtered = useMemo(
    () =>
      rows
        .filter((r) => themeFilter === 'all' || r.theme === themeFilter)
        .filter((r) => statusFilter === 'all' || r.status === statusFilter)
        .filter((r) => {
          if (resolvedFilter === 'all') return true;
          if (resolvedFilter === 'changed') {
            const was = previous.get(r.control_id);
            return was !== undefined && was !== r.status;
          }
          return (resolvedFilter === 'resolved') === Boolean(r.current?.resolved);
        }),
    [rows, themeFilter, statusFilter, resolvedFilter, previous],
  );

  const applicable = rows.filter((r) => r.status !== 'not_applicable');
  const compliant = applicable.filter((r) => r.status === 'pass').length;
  const openGaps = rows.filter((r) => r.status === 'fail' && !r.current?.resolved).length;
  const resolvedCount = rows.filter((r) => r.current?.resolved).length;
  const changedCount = previous.size ? rows.filter((r) => (previous.get(r.control_id) ?? r.status) !== r.status).length : 0;
  const systemLabel = ISO27001_SYSTEMS.find((s) => s.key === system)?.label ?? system;
  const shownRun = viewingPast ? runs.find((r) => r.id === selectedRun) : runs[0];

  async function importLedger(file: File) {
    setImporting(true);
    setImportMsg(null);
    try {
      let ledger: unknown;
      try {
        ledger = JSON.parse(await file.text());
      } catch {
        throw new Error(`${file.name} is not valid JSON`);
      }
      const res = await fetch('/api/iso27001/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system_name: system, ledger }),
      });
      const data = (await res.json().catch(() => ({}))) as { run?: Iso27001AuditRun; detail?: string };
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setImportMsg({ ok: true, text: `Imported the ${data.run?.run_date} run for ${systemLabel}.` });
      setSelectedRun(CURRENT);
      await load();
    } catch (e) {
      setImportMsg({ ok: false, text: `Import failed: ${e instanceof Error ? e.message : String(e)}` });
    }
    setImporting(false);
  }

  return (
    <>
      <div className="app-page-header">
        <div>
          <h1>ISO 27001 audit</h1>
          <p className="app-page-sub">
            Annex A control status per system, from the `compliance-audit` skill. Every imported run
            is kept, and every answer you save is added to that control&apos;s history.
          </p>
        </div>
      </div>

      <div className="app-card">
        <div className="acl-toolbar">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              className="acl-input"
              value={system}
              onChange={(e) => {
                setSystem(e.target.value);
                setSelectedRun(CURRENT);
                setImportMsg(null);
              }}
              style={{ width: 'auto' }}
              aria-label="System"
            >
              {ISO27001_SYSTEMS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
            <select
              className="acl-input"
              value={selectedRun}
              onChange={(e) => setSelectedRun(e.target.value)}
              style={{ width: 'auto' }}
              aria-label="Audit run"
              disabled={runs.length === 0}
            >
              <option value={CURRENT}>Current{runs[0] ? ` (run ${runs[0].run_date})` : ''}</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {runLabel(r)}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void importLedger(f);
              }}
            />
            <button className="acl-btn-cancel" onClick={() => fileInput.current?.click()} disabled={importing}>
              {importing ? 'Importing…' : '⤒ Import run'}
            </button>
            <button className="acl-btn-cancel" onClick={() => void load()} disabled={loading}>
              {loading ? 'Loading…' : '↺ Refresh'}
            </button>
          </div>
        </div>

        <div className="acl-toolbar" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="acl-muted">
            {loadedAt ? `Loaded ${loadedAt.toLocaleTimeString()} · ` : ''}
            {!loading && !error && rows.length > 0 && (
              <>
                {applicable.length ? Math.round((100 * compliant) / applicable.length) : 0}% compliant
                {' · '}
                {openGaps} open gap{openGaps === 1 ? '' : 's'}
                {' · '}
                {resolvedCount} of {rows.length} resolved
                {previous.size > 0 && ` · ${changedCount} changed since the previous run`}
                {shownRun && shownRun.imported_by_email && ` · imported by ${shownRun.imported_by_email}`}
              </>
            )}
          </div>
        </div>

        {(importMsg || runsError || viewingPast) && (
          <div style={{ padding: '0 20px' }}>
            {importMsg && <p className={`acl-hint ${importMsg.ok ? 'acl-hint--ok' : 'acl-hint--bad'}`}>{importMsg.text}</p>}
            {runsError && <p className="acl-hint acl-hint--warn">{runsError}</p>}
            {viewingPast && (
              <p className="acl-hint acl-hint--warn">
                Viewing a saved run — statuses are as that run found them. Answers are shown as they are now;
                switch to Current to add one.
              </p>
            )}
          </div>
        )}

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
              value={resolvedFilter}
              onChange={(e) => setResolvedFilter(e.target.value as typeof resolvedFilter)}
              style={{ width: 'auto' }}
            >
              <option value="all">Resolved + open</option>
              <option value="open">Open only</option>
              <option value="resolved">Resolved only</option>
              <option value="changed" disabled={previous.size === 0}>
                Changed since previous run
              </option>
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
        ) : rows.length === 0 ? (
          <p className="acl-empty">
            {systemLabel} has not been audited yet. Run the <code>compliance-audit</code> skill for it, then
            use <strong>Import run</strong> to load <code>compliance/systems/{system}/ledger.json</code>.
          </p>
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
                {filtered.map((row) => {
                  const was = previous.get(row.control_id);
                  return (
                    <tr key={row.control_id} className="acl-row">
                      <td className="acl-tenant">{row.control_id}</td>
                      <td>
                        <button className="acl-name-link" onClick={() => setOpened(row)}>
                          {row.title}
                        </button>
                      </td>
                      <td>
                        <StatusPill status={row.status} />
                        {was && was !== row.status && (
                          <span className="acl-muted" style={{ marginLeft: 8 }}>
                            was {STATUS_LABEL[was]}
                          </span>
                        )}
                      </td>
                      <td>
                        {row.current?.resolved ? (
                          <span className="acl-toggle acl-toggle--on">Resolved</span>
                        ) : (
                          <span className="acl-muted">{row.current?.resolution_answer ? 'Commented' : 'Open'}</span>
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

      {opened?.current && (
        <ResolveControlModal
          control={opened.current}
          snapshot={viewingPast ? opened : null}
          onClose={() => setOpened(null)}
          onResolved={(updated) => {
            setCurrent((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
            setOpened(null);
          }}
        />
      )}
    </>
  );
}
