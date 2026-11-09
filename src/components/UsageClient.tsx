'use client';

import { useEffect, useState } from 'react';

/**
 * How the traceability app is used, per account — traceability-matrix `usage_daily` via
 * GET /api/usage (staff only). Anonymous by design: daily totals only, no user is stored, so
 * nothing here can show what one person did. "Active users" = distinct people that UTC day.
 */

type Row = Record<string, string | number | null>;
interface Summary { accounts?: Row[]; totals?: Row[]; since?: string }
interface Detail { account: string; since: string; by_day: Row[]; pages: Row[]; actions: Row[] }

const RANGES = [7, 30, 90, 365];
const sum = (rows: Row[], k: string) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);

/** Where the viewer left the page (region, period, open account) — restored on refresh. Per browser only. */
const VIEW_KEY = 'usage.view';
interface View { region?: string; days?: number; account?: string }
function readView(): View {
  try { return JSON.parse(localStorage.getItem(VIEW_KEY) || '{}') as View; } catch { return {}; }
}
function writeView(v: View) {
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(v)); } catch { /* storage blocked — not fatal */ }
}

export default function UsageClient() {
  const [region, setRegion] = useState<string>('');
  const [regions, setRegions] = useState<string[]>([]);
  const [days, setDays] = useState(30);
  const [account, setAccount] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  // Storage is read after mount (not in useState) so the server render and hydration agree;
  // nothing is fetched until it has been read, or the first request would go to the default region.
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const v = readView();
    if (typeof v.region === 'string') setRegion(v.region);
    if (typeof v.days === 'number' && RANGES.includes(v.days)) setDays(v.days);
    if (typeof v.account === 'string') setAccount(v.account);
    setRestored(true);
  }, []);

  useEffect(() => {
    if (restored) writeView({ region, days, account });
  }, [restored, region, days, account]);

  useEffect(() => {
    if (!restored) return;
    let off = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const q = new URLSearchParams({ days: String(days) });
        if (region) q.set('region', region);
        if (account) q.set('account', account);
        const res = await fetch(`/api/usage?${q}`, { cache: 'no-store' });
        const data = await res.json();
        if (off) return;
        if (data.regions) setRegions(data.regions);
        // The server answers for its own region when the asked one is not configured (e.g. a
        // remembered EU after TRACE_API_URL_EU was removed) — follow it so the selector tells the truth.
        if (data.region && data.region !== region) setRegion(data.region);
        if (!res.ok) throw new Error(
          res.status === 501
            ? 'This region runs a version without usage statistics yet — deploy traceability-matrix first.'
            : data.detail || `HTTP ${res.status}`);
        if (account) setDetail(data as Detail); else { setSummary(data as Summary); setDetail(null); }
      } catch (e) {
        if (!off) setErr(e instanceof Error ? e.message : String(e));
      }
      if (!off) setLoading(false);
    })();
    return () => { off = true; };
  }, [restored, region, days, account]);

  const days_ = detail?.by_day ?? summary?.totals ?? [];
  const maxUsers = Math.max(1, ...days_.map((d) => Number(d.users) || 0));

  return (
    <>
      <div className="app-page-header">
        <div>
          <h1>Usage</h1>
          <p className="app-page-sub">
            How each account uses Traceability: sign-ins, active users, time in the app, pages and actions.
            Anonymous totals only. No user is recorded, so no one person can be followed.
          </p>
        </div>
      </div>

      <div className="acl-toolbar" style={{ gap: 12, flexWrap: 'wrap' }}>
        {account && <button className="acl-btn-cancel" onClick={() => setAccount('')}>← All accounts</button>}
        {regions.length > 1 && (
          <select value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region">
            {regions.map((r) => <option key={r} value={r}>{r.toUpperCase()}</option>)}
          </select>
        )}
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
          {RANGES.map((d) => <option key={d} value={d}>Last {d} days</option>)}
        </select>
      </div>

      {err && <p className="acl-error">{err}</p>}
      {loading && <p className="acl-empty">Loading…</p>}

      {!loading && !err && !account && summary && (
        <>
          <Tiles items={[
            ['Accounts active', (summary.accounts ?? []).length],
            ['Sign-ins', sum(summary.accounts ?? [], 'logins')],
            ['Hours in app', Math.round(sum(summary.accounts ?? [], 'hours') * 10) / 10],
            ['Actions', sum(summary.accounts ?? [], 'actions')],
          ]} />
          <DayBars title="Active users per day (all accounts)" rows={summary.totals ?? []} max={maxUsers} />
          <div className="app-card">
            {(summary.accounts ?? []).length === 0 ? (
              <p className="acl-empty">No usage in this period yet.</p>
            ) : (
              <table className="acl-table">
                <thead><tr>
                  <th>Account</th><th>Sign-ins</th><th>Peak users / day</th><th>Hours in app</th>
                  <th>Page views</th><th>Actions</th><th>Days active</th><th>Last active (UTC)</th>
                </tr></thead>
                <tbody>
                  {(summary.accounts ?? []).map((a) => (
                    <tr key={String(a.account)} style={{ cursor: 'pointer' }} onClick={() => setAccount(String(a.account))}>
                      <td><a href="#" onClick={(e) => { e.preventDefault(); setAccount(String(a.account)); }}>{String(a.account)}</a></td>
                      <td>{a.logins}</td><td>{a.peak_users}</td><td>{a.hours}</td>
                      <td>{a.page_views}</td><td>{a.actions}</td><td>{a.active_days}</td>
                      <td className="acl-muted">{String(a.last_day ?? '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {!loading && !err && account && detail && (
        <>
          <Tiles items={[
            ['Sign-ins', sum(detail.by_day, 'logins')],
            ['Peak users / day', Math.max(0, ...detail.by_day.map((d) => Number(d.users) || 0))],
            ['Hours in app', Math.round(sum(detail.by_day, 'minutes') / 6) / 10],
            ['Page views', sum(detail.by_day, 'page_views')],
            ['Actions', sum(detail.by_day, 'actions')],
          ]} />
          <DayBars title={`${detail.account} · active users per day`} rows={detail.by_day} max={maxUsers} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
            <div className="app-card" style={{ padding: 16 }}>
              <h2 className="acl-section-title">Pages (time spent)</h2>
              {detail.pages.length === 0 ? <p className="acl-empty">—</p> : (
                <table className="acl-table">
                  <thead><tr><th>Page</th><th style={{ width: 70 }}>Views</th><th style={{ width: 90 }}>Minutes</th></tr></thead>
                  <tbody>{detail.pages.map((p) => (
                    <tr key={String(p.page)}><td><code>{p.page}</code></td><td>{p.views}</td><td>{p.minutes}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </div>
            <div className="app-card" style={{ padding: 16 }}>
              <h2 className="acl-section-title">Actions (saves, builds, exports …)</h2>
              {detail.actions.length === 0 ? <p className="acl-empty">—</p> : (
                <table className="acl-table">
                  <thead><tr><th>Action</th><th style={{ width: 70 }}>Count</th></tr></thead>
                  <tbody>{detail.actions.map((a) => (
                    <tr key={String(a.action)}><td><code>{a.action}</code></td><td>{a.count}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function Tiles({ items }: { items: [string, string | number][] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
      {items.map(([k, v]) => (
        <div key={k} className="app-card" style={{ padding: 16 }}>
          <div className="acl-muted" style={{ fontSize: 12 }}>{k}</div>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

function DayBars({ title, rows, max }: { title: string; rows: Row[]; max: number }) {
  if (!rows.length) return null;
  return (
    <div className="app-card" style={{ padding: 16, marginBottom: 16 }}>
      <h2 className="acl-section-title">{title}</h2>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 90 }}>
        {rows.map((d) => (
          <div key={String(d.day)} title={`${d.day}: ${d.users} users, ${d.logins} sign-ins`}
            style={{ flex: 1, minWidth: 3, borderRadius: '3px 3px 0 0', background: '#652AA5',
              height: `${Math.max(2, ((Number(d.users) || 0) / max) * 100)}%` }} />
        ))}
      </div>
      <div className="acl-muted" style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <span>{String(rows[0].day)}</span><span>{String(rows[rows.length - 1].day)}</span>
      </div>
    </div>
  );
}
