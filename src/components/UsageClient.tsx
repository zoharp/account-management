'use client';

import { useEffect, useState } from 'react';

/**
 * How the traceability app is used, per account — traceability-matrix `usage_daily` via
 * GET /api/usage (staff only). Anonymous by design: daily totals only, no user is stored, so
 * nothing here can show what one person did. "Active users" = distinct people that UTC day.
 * Trend (2026-11-11): each account's hours in this period vs the period of the same length before —
 * the rule (slipping / gone quiet / growing) is computed in traceability-matrix `usage_analytics._trend`.
 */

type Row = Record<string, string | number | null>;
interface Totals { accounts: number; logins: number; hours: number; user_days: number; actions: number }
interface Summary {
  accounts?: Row[]; totals?: Row[]; since?: string;
  current?: Totals; previous?: Totals | null; modules?: Row[]; account_days?: Row[];
}
interface Detail { account: string; since: string; by_day: Row[]; pages: Row[]; actions: Row[]; modules?: Row[] }

const RANGES = [7, 30, 90, 365, 800]; // 800 = all kept (traceability keeps 800 days)
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

  const accounts = summary?.accounts ?? [];
  const sinceDay = (account ? detail?.since : summary?.since) ?? '';
  const dayRows = fillDays((account ? detail?.by_day : summary?.totals) ?? [], sinceDay);
  const attention = accounts.filter((a) => a.trend === 'slipping' || a.trend === 'quiet')
    .sort((a, b) => (Number(b.prev_hours) || 0) - (Number(a.prev_hours) || 0));
  const spark: Record<string, Row[]> = {};
  for (const r of summary?.account_days ?? []) (spark[String(r.account)] ??= []).push(r);
  const cur = summary?.current;
  const prev = summary?.previous;

  return (
    <>
      <div className="app-page-header">
        <div>
          <h1>Usage</h1>
          <p className="app-page-sub">
            How each account uses Traceability: sign-ins, active users, time in the app, modules and actions.
            Anonymous totals only. No user is recorded, so no one person can be followed.
          </p>
        </div>
      </div>

      <div className="acl-toolbar" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {account && <button className="acl-btn-cancel" onClick={() => setAccount('')}>← All accounts</button>}
        {regions.length > 1 && (
          <select className="acl-select" value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region">
            {regions.map((r) => <option key={r} value={r}>{r.toUpperCase()}</option>)}
          </select>
        )}
        <select className="acl-select" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
          {RANGES.map((d) => <option key={d} value={d}>{d === 800 ? 'All time' : `Last ${d} days`}</option>)}
        </select>
        {sinceDay && <span className="acl-muted" style={{ fontSize: 12 }}>from {sinceDay} (UTC)</span>}
      </div>

      {err && <p className="acl-error">{err}</p>}
      {loading && <p className="acl-empty">Loading…</p>}

      {!loading && !err && !account && summary && (
        <>
          <Tiles
            items={[
              ['Accounts active', cur?.accounts ?? accounts.length, prev?.accounts],
              ['Sign-ins', cur?.logins ?? sum(accounts, 'logins'), prev?.logins],
              ['Hours in app', cur?.hours ?? sum(accounts, 'hours'), prev?.hours],
              ['User-days', cur?.user_days ?? sum(accounts, 'user_days'), prev?.user_days],
              ['Actions', cur?.actions ?? sum(accounts, 'actions'), prev?.actions],
            ]}
            note={prev ? `vs the ${days} days before` : days === 800 ? '' : 'no earlier data to compare'}
          />

          <div style={GRID2}>
            <AreaChart title="Active users per day" rows={dayRows} k="users" unit="users" />
            <AreaChart title="Hours in app per day" rows={dayRows} k="hours" unit="h" />
          </div>

          <div style={GRID2}>
            <ModuleBars modules={summary.modules ?? []} />
            <div className="app-card" style={{ padding: 16, marginBottom: 16 }}>
              <h2 className="acl-section-title">Needs attention</h2>
              {attention.length === 0 ? (
                <p className="acl-empty">
                  No account is slipping{prev ? '.' : ' (no earlier period to compare with yet).'}
                </p>
              ) : (
                <table className="acl-table">
                  <thead><tr><th>Account</th><th>Hours before → now</th><th>Last active</th><th>Status</th></tr></thead>
                  <tbody>{attention.map((a) => (
                    <tr key={String(a.account)} style={{ cursor: 'pointer' }} onClick={() => setAccount(String(a.account))}>
                      <td>{String(a.account)}</td>
                      <td>{a.prev_hours ?? 0} → {a.hours ?? 0} <span className="acl-muted">{pct(a.hours, a.prev_hours)}</span></td>
                      <td className="acl-muted">{String(a.last_day ?? '—')}</td>
                      <td><TrendChip t={String(a.trend)} /></td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          </div>

          <div className="app-card" style={{ overflowX: 'auto' }}>
            {accounts.length === 0 ? (
              <p className="acl-empty">No usage in this period yet.</p>
            ) : (
              <table className="acl-table">
                <thead><tr>
                  <th>Account</th><th>Trend</th><th>Hours per day</th><th>Most used</th><th>Sign-ins</th>
                  <th>Peak users / day</th><th>Hours in app</th><th>Actions</th><th>Days active</th><th>Last active (UTC)</th>
                </tr></thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={String(a.account)} style={{ cursor: 'pointer' }} onClick={() => setAccount(String(a.account))}>
                      <td><a href="#" onClick={(e) => { e.preventDefault(); setAccount(String(a.account)); }}>{String(a.account)}</a></td>
                      <td><TrendChip t={String(a.trend)} /></td>
                      <td><Spark rows={fillDays(spark[String(a.account)] ?? [], sinceDay)} /></td>
                      <td>{a.top_module ?? '—'}</td>
                      <td>{a.logins}</td><td>{a.peak_users}</td><td>{a.hours}</td>
                      <td>{a.actions}</td><td>{a.active_days}</td>
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
          <div style={GRID2}>
            <AreaChart title={`${detail.account} · active users per day`} rows={dayRows} k="users" unit="users" />
            <AreaChart title={`${detail.account} · minutes in app per day`} rows={dayRows} k="minutes" unit="min" />
          </div>
          <ModuleBars modules={detail.modules ?? []} />
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

const GRID2: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 };
const INK = 'var(--accent-primary)';

/** "+25%" / "−40%" between two numbers; "" when there is nothing to compare. */
function pct(now: unknown, before: unknown): string {
  const b = Number(before) || 0;
  const n = Number(now) || 0;
  if (!b) return '';
  const p = Math.round(((n - b) / b) * 100);
  return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)}%`;
}

/** Days with no row are real zeros — fill them so a quiet week shows as a dip, not a skipped gap. */
function fillDays(rows: Row[], since: string): Row[] {
  if (!since) return rows;
  const by = new Map(rows.map((r) => [String(r.day), r]));
  const d = new Date(`${since}T00:00:00Z`);
  // "All time" starts 800 days back — begin at the first day with data instead of two years of zeros.
  if (rows.length) {
    const first = new Date(`${String(rows[0].day)}T00:00:00Z`);
    if (first > d) d.setTime(first.getTime());
  }
  const end = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const out: Row[] = [];
  for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = d.toISOString().slice(0, 10);
    out.push(by.get(k) ?? { day: k });
  }
  return out;
}

const TREND: Record<string, [string, string, string, string]> = {   // label, icon, tone, hover text
  growing: ['Growing', '▲', 'ok', 'Hours in app rose 40% or more against the period before'],
  steady: ['Steady', '■', 'muted', 'About the same as the period before'],
  new: ['New', '●', 'muted', 'No use in the period before'],
  slipping: ['Slipping', '▼', 'warn', 'Hours in app fell 40% or more against the period before'],
  quiet: ['Gone quiet', '⏸', 'err', 'No use for 14 days or more'],
};
function TrendChip({ t }: { t: string }) {
  const [label, icon, tone, tip] = TREND[t] ?? ['—', '', 'muted', ''];
  const c = tone === 'muted'
    ? { bg: 'var(--bg-subtle)', fg: 'var(--text-secondary)', bd: 'var(--border)' }
    : { bg: `var(--${tone}-bg)`, fg: `var(--${tone}-fg)`, bd: `var(--${tone}-border)` };
  return (
    <span title={tip} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 12, fontWeight: 500,
      padding: '2px 8px', borderRadius: 999, background: c.bg, color: c.fg, border: `1px solid ${c.bd}`, whiteSpace: 'nowrap' }}>
      <span aria-hidden style={{ fontSize: 9 }}>{icon}</span>{label}
    </span>
  );
}

function Tiles({ items, note }: { items: [string, string | number, (string | number | null)?][]; note?: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
      {items.map(([k, v, before]) => {
        const p = before !== undefined && before !== null ? pct(v, before) : '';
        const up = p.startsWith('+');
        const down = p.startsWith('−');
        return (
          <div key={k} className="app-card" style={{ padding: 16 }}>
            <div className="acl-muted" style={{ fontSize: 12 }}>{k}</div>
            <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--text-primary)' }}>{v}</div>
            {p ? (
              <div style={{ fontSize: 12, color: up ? 'var(--ok-fg)' : down ? 'var(--err-fg)' : 'var(--text-secondary)' }}
                title={`${before} in the period before`}>
                {up ? '▲' : down ? '▼' : '■'} {p} <span className="acl-muted">{note}</span>
              </div>
            ) : note ? <div className="acl-muted" style={{ fontSize: 12 }}>{note}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

/** One measure per day as a thin line over a soft area, with a crosshair + tooltip on hover. */
function AreaChart({ title, rows, k, unit }: { title: string; rows: Row[]; k: string; unit: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!rows.length) return null;
  const W = 600;
  const H = 150;
  const P = { l: 34, r: 8, t: 8, b: 8 };
  const vals = rows.map((r) => Number(r[k]) || 0);
  const max = niceMax(Math.max(...vals));
  const x = (i: number) => P.l + (rows.length === 1 ? (W - P.l - P.r) / 2 : (i / (rows.length - 1)) * (W - P.l - P.r));
  const y = (v: number) => P.t + (1 - v / max) * (H - P.t - P.b);
  const line = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = `${line}L${x(vals.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const total = vals.reduce((a, b) => a + b, 0);
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - b.left) / b.width) * W;
    const i = Math.round(((px - P.l) / (W - P.l - P.r)) * (rows.length - 1));
    setHover(Math.max(0, Math.min(rows.length - 1, i)));
  };
  return (
    <div className="app-card" style={{ padding: 16, marginBottom: 16, position: 'relative' }}>
      <h2 className="acl-section-title" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span>{title}</span>
        <span className="acl-muted" style={{ fontSize: 12, fontWeight: 400 }}>
          {unit === 'users' ? `peak ${Math.max(...vals)}` : `total ${fmt(total)} ${unit}`}
        </span>
      </h2>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img"
        aria-label={`${title}: ${rows.length} days`} onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        style={{ display: 'block', overflow: 'visible' }}>
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={P.l} x2={W - P.r} y1={y(max * f)} y2={y(max * f)} stroke="var(--border)" strokeWidth={1}
            vectorEffect="non-scaling-stroke" />
        ))}
        <path d={area} fill={INK} opacity={0.12} />
        <path d={line} fill="none" stroke={INK} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} stroke="var(--text-muted)" strokeWidth={1}
            strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {/* Axis labels and the hover dot sit outside the stretched SVG so text and circles keep their shape. */}
      <div style={{ position: 'absolute', left: 16, top: 48, height: H, width: P.l - 6, pointerEvents: 'none' }}>
        {[1, 0.5, 0].map((f) => (
          <span key={f} className="acl-muted" style={{ position: 'absolute', right: 0, top: y(max * f) - 7, fontSize: 10 }}>
            {fmt(max * f)}
          </span>
        ))}
      </div>
      {(hover !== null || rows.length === 1) && (() => {
        const i = hover ?? 0;
        const left = `calc(16px + ${(x(i) / W)} * (100% - 32px))`;
        return (
          <>
            <span style={{ position: 'absolute', left, top: 48 + y(vals[i]), width: 10, height: 10, marginLeft: -5, marginTop: -5,
              borderRadius: 999, background: INK, border: '2px solid var(--bg-surface)', pointerEvents: 'none' }} />
            {hover !== null && (
              <div style={{ position: 'absolute', top: 44, left, transform: `translateX(${i > rows.length / 2 ? 'calc(-100% - 12px)' : '12px'})`,
                background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px',
                fontSize: 12, boxShadow: '0 2px 8px rgba(0,0,0,.08)', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
                <div className="acl-muted">{String(rows[i].day)}</div>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{fmt(vals[i])} {unit}</div>
              </div>
            )}
          </>
        );
      })()}
      <div className="acl-muted" style={{ fontSize: 11, display: 'flex', justifyContent: 'space-between', marginTop: 4, paddingLeft: P.l * 0.6 }}>
        <span>{String(rows[0].day)}</span><span>{String(rows[rows.length - 1].day)}</span>
      </div>
    </div>
  );
}

/** Hours per module, longest first — one hue (it's a magnitude), value labelled at the bar end. */
function ModuleBars({ modules }: { modules: Row[] }) {
  const max = Math.max(0.1, ...modules.map((m) => Number(m.hours) || 0));
  const total = modules.reduce((s, m) => s + (Number(m.hours) || 0), 0);
  return (
    <div className="app-card" style={{ padding: 16, marginBottom: 16 }}>
      <h2 className="acl-section-title">
        Most used modules <span className="acl-muted" style={{ fontSize: 12, fontWeight: 400 }}>· time in app</span>
      </h2>
      {modules.length === 0 ? <p className="acl-empty">No page views in this period.</p> : (
        <div style={{ display: 'grid', gap: 6 }}>
          {modules.map((m) => {
            const h = Number(m.hours) || 0;
            const share = total ? Math.round((h / total) * 100) : 0;
            return (
              <div key={String(m.module)} title={`${m.module}: ${h} h, ${m.views} page views, ${share}% of time`}
                style={{ display: 'grid', gridTemplateColumns: '120px 1fr 84px', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {String(m.module)}
                </span>
                <div style={{ background: 'var(--bg-subtle)', borderRadius: 4, height: 14 }}>
                  <div style={{ width: `${Math.max(1, (h / max) * 100)}%`, height: '100%', background: INK, borderRadius: '0 4px 4px 0' }} />
                </div>
                <span style={{ color: 'var(--text-secondary)', textAlign: 'right' }}>{h} h · {share}%</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Tiny hours-per-day line in the accounts table; no axes, the trend chip says what it means. */
function Spark({ rows }: { rows: Row[] }) {
  if (rows.length < 2) return <span className="acl-muted">—</span>;
  const vals = rows.map((r) => Number(r.hours) || 0);
  const max = Math.max(0.01, ...vals);
  const W = 90;
  const H = 22;
  const d = vals
    .map((v, i) => `${i ? 'L' : 'M'}${((i / (vals.length - 1)) * W).toFixed(1)},${(H - 2 - (v / max) * (H - 4)).toFixed(1)}`)
    .join('');
  return (
    <svg width={W} height={H} role="img" aria-label="hours in app per day">
      <path d={d} fill="none" stroke={INK} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}
function fmt(v: number): string {
  return v >= 10 || Number.isInteger(v) ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
}
