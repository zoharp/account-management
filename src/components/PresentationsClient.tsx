'use client';

import { useEffect, useState } from 'react';

/**
 * Who opens the customer presentations (traceability.orcanos.ai/orcanos-<deck>.html).
 * Data: traceability-matrix `deck_events` via GET /api/presentations (staff only). No cookies on
 * the deck side; a "visitor" is a salted IP hash, a "view" is one page load.
 */

type Row = Record<string, string | number | null>;
interface Summary { decks?: Row[]; since?: string; geo_attribution?: string }
interface Detail {
  deck: string; views: number; visitors: number; avg_minutes: number; avg_slides_seen: number; finished: number;
  slides: Row[]; by_country: Row[]; by_campaign: Row[]; by_referrer: Row[]; by_device: Row[]; by_language: Row[];
  by_day: Row[];
}

const RANGES = [7, 30, 90, 365];

export default function PresentationsClient() {
  const [region, setRegion] = useState<string>('');
  const [regions, setRegions] = useState<string[]>([]);
  const [days, setDays] = useState(30);
  const [deck, setDeck] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const q = new URLSearchParams({ days: String(days) });
        if (region) q.set('region', region);
        if (deck) q.set('deck', deck);
        const res = await fetch(`/api/presentations?${q}`, { cache: 'no-store' });
        const data = await res.json();
        if (off) return;
        if (data.regions) setRegions(data.regions);
        if (!region && data.region) setRegion(data.region);
        if (!res.ok) throw new Error(
          res.status === 501
            ? 'This region runs a version without presentation tracking yet — deploy traceability-matrix first.'
            : data.detail || `HTTP ${res.status}`);
        if (deck) setDetail(data as Detail); else { setSummary(data as Summary); setDetail(null); }
      } catch (e) {
        if (!off) setErr(e instanceof Error ? e.message : String(e));
      }
      if (!off) setLoading(false);
    })();
    return () => { off = true; };
  }, [region, days, deck]);

  const maxSlideViews = Math.max(1, ...(detail?.slides ?? []).map((s) => Number(s.views) || 0));

  return (
    <>
      <div className="app-page-header">
        <div>
          <h1>Presentations</h1>
          <p className="app-page-sub">
            Who opens the customer presentations, how far they read, and where they came from.
            No cookies; visitors are counted by a hashed IP address.
          </p>
        </div>
      </div>

      <div className="acl-toolbar" style={{ gap: 12, flexWrap: 'wrap' }}>
        {deck && <button className="acl-btn-cancel" onClick={() => setDeck('')}>← All presentations</button>}
        {regions.length > 1 && (
          <select className="acl-select" value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region">
            {regions.map((r) => <option key={r} value={r}>{r.toUpperCase()}</option>)}
          </select>
        )}
        <select className="acl-select" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
          {RANGES.map((d) => <option key={d} value={d}>Last {d} days</option>)}
        </select>
      </div>

      {err && <p className="acl-error">{err}</p>}
      {loading && <p className="acl-empty">Loading…</p>}

      {!loading && !err && !deck && summary && (
        <div className="app-card">
          {(summary.decks ?? []).length === 0 ? (
            <p className="acl-empty">No views in this period yet.</p>
          ) : (
            <table className="acl-table">
              <thead><tr><th>Presentation</th><th>Views</th><th>Visitors</th><th>Avg. time</th><th>Last view (UTC)</th></tr></thead>
              <tbody>
                {(summary.decks ?? []).map((d) => (
                  <tr key={String(d.deck)} style={{ cursor: 'pointer' }} onClick={() => setDeck(String(d.deck))}>
                    <td><a href="#" onClick={(e) => { e.preventDefault(); setDeck(String(d.deck)); }}>{String(d.deck)}</a></td>
                    <td>{d.views}</td><td>{d.visitors}</td><td>{d.avg_minutes} min</td>
                    <td className="acl-muted">{String(d.last_view ?? '').replace('T', ' ').slice(0, 16)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!loading && !err && deck && detail && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
            {[
              ['Views', detail.views],
              ['Visitors', detail.visitors],
              ['Avg. time', `${detail.avg_minutes} min`],
              ['Avg. slides seen', detail.avg_slides_seen],
              ['Read to the end', detail.finished],
            ].map(([k, v]) => (
              <div key={String(k)} className="app-card" style={{ padding: 16 }}>
                <div className="acl-muted" style={{ fontSize: 12 }}>{k}</div>
                <div style={{ fontSize: 24, fontWeight: 600 }}>{v}</div>
              </div>
            ))}
          </div>

          <div className="app-card" style={{ padding: 16, marginBottom: 16 }}>
            <h2 className="acl-section-title">{detail.deck} · views per slide</h2>
            <table className="acl-table">
              <thead><tr><th style={{ width: 70 }}>Slide</th><th>Views</th><th style={{ width: 110 }}>Avg. time</th></tr></thead>
              <tbody>
                {detail.slides.map((s) => (
                  <tr key={String(s.slide)}>
                    <td>{s.slide}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ height: 10, borderRadius: 5, background: '#652AA5',
                          width: `${(Number(s.views) / maxSlideViews) * 100}%`, minWidth: 2 }} />
                        <span>{s.views}</span>
                      </div>
                    </td>
                    <td>{s.avg_seconds ?? '—'} s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
            <Breakdown title="Country" rows={detail.by_country} k="country" />
            <Breakdown title="Came from" rows={detail.by_referrer} k="referrer" />
            <Breakdown title="Device" rows={detail.by_device} k="device" />
            <Breakdown title="Language" rows={detail.by_language} k="language" />
            <Breakdown title="Views per day" rows={detail.by_day} k="day" />
            <div className="app-card" style={{ padding: 16, gridColumn: '1 / -1' }}>
              <h2 className="acl-section-title">Campaign (UTM)</h2>
              <table className="acl-table">
                <thead><tr><th>Source</th><th>Medium</th><th>Campaign</th><th>Link (content)</th><th>Views</th></tr></thead>
                <tbody>
                  {detail.by_campaign.map((r, i) => (
                    <tr key={i}>
                      <td>{r.utm_source || '—'}</td><td>{r.utm_medium || '—'}</td>
                      <td>{r.utm_campaign || '—'}</td><td>{r.utm_content || '—'}</td><td>{r.views}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="acl-muted" style={{ fontSize: 12, marginTop: 12 }}>IP geolocation by DB-IP (db-ip.com).</p>
        </>
      )}
    </>
  );
}

function Breakdown({ title, rows, k }: { title: string; rows: Row[]; k: string }) {
  return (
    <div className="app-card" style={{ padding: 16 }}>
      <h2 className="acl-section-title">{title}</h2>
      {rows.length === 0 ? <p className="acl-empty">—</p> : (
        <table className="acl-table">
          <tbody>
            {rows.map((r, i) => <tr key={i}><td>{String(r[k] || '(unknown)')}</td><td style={{ width: 70 }}>{r.views}</td></tr>)}
          </tbody>
        </table>
      )}
    </div>
  );
}
