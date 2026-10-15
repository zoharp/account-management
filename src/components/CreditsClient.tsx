'use client';

import { useEffect, useState } from 'react';

/**
 * The credits setting — ONE for every account. Ask Paul shows customers credits instead of
 * $ and tokens: credits = cost (USD) × markup × credits per $1. Customers are not billed yet;
 * this only decides what the number on their screen means. Stored in master `platform_settings`.
 */
export default function CreditsClient() {
  const [perUsd, setPerUsd] = useState('100');
  const [markup, setMarkup] = useState('1');
  const [meta, setMeta] = useState<{ updated_at: string | null; updated_by: string | null; migrated: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/settings/credits', { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
        setPerUsd(String(data.credits_per_usd));
        setMarkup(String(data.markup));
        setMeta({ updated_at: data.updated_at, updated_by: data.updated_by, migrated: data.migrated });
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
      }
      setLoading(false);
    })();
  }, []);

  const p = Number(perUsd);
  const m = Number(markup);
  const valid = p > 0 && m > 0;
  const per = valid ? p * m : 0; // credits charged per $1 of real cost
  const examples = [
    { label: 'A chat question', usd: 0.02 },
    { label: 'Indexing a document', usd: 0.05 },
    { label: 'An agent run', usd: 0.15 },
  ];
  const fmt = (n: number) => (n < 10 ? n.toFixed(1) : Math.round(n).toLocaleString());

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/settings/credits', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credits_per_usd: p, markup: m }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setMsg({ ok: true, text: 'Saved. Ask Paul picks it up within 30 seconds, for every account.' });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
    setSaving(false);
  }

  return (
    <>
      <div className="app-page-header">
        <div>
          <h1>Credits</h1>
          <p className="app-page-sub">
            How a cost in dollars becomes the credits customers see in Ask Paul. One setting for
            every account.
          </p>
        </div>
      </div>

      <div className="app-card" style={{ padding: 24, maxWidth: 640 }}>
        {loading ? (
          <p className="acl-empty">Loading…</p>
        ) : (
          <>
            {meta && !meta.migrated && (
              <div className="acl-error" style={{ marginBottom: 14 }}>
                The master database has no <code>platform_settings</code> table yet — run{' '}
                <code>sql/008_platform_settings.sql</code> first. Until then Ask Paul uses the
                defaults (100 credits per $1, markup 1.0) and saving is refused.
              </div>
            )}
            <div className="acl-field-row">
              <label className="acl-label" htmlFor="cr-per">Credits per $1</label>
              <input id="cr-per" className="acl-input" type="number" min="0" step="any" value={perUsd} onChange={(e) => setPerUsd(e.target.value)} />
            </div>
            <div className="acl-field-row">
              <label className="acl-label" htmlFor="cr-mk">Markup</label>
              <input id="cr-mk" className="acl-input" type="number" min="0" step="any" value={markup} onChange={(e) => setMarkup(e.target.value)} />
            </div>
            <p className="acl-hint">
              credits = cost in USD × markup × credits per $1. Markup 1.0 means credits track our
              real cost; raise it to add margin later. Credits are worked out when shown, not
              stored — changing this re-prices past usage too.
            </p>

            <h3 className="acl-section-title" style={{ marginTop: 18 }}>What it means</h3>
            <table className="acl-table">
              <tbody>
                {examples.map((x) => (
                  <tr key={x.label}>
                    <td>{x.label} <span className="acl-muted">(about ${x.usd.toFixed(2)} real cost)</span></td>
                    <td className="acl-num">{valid ? fmt(x.usd * per) : '—'} credits</td>
                  </tr>
                ))}
                <tr>
                  <td>$1 of real cost</td>
                  <td className="acl-num">{valid ? fmt(per) : '—'} credits</td>
                </tr>
              </tbody>
            </table>

            {msg && <div className={msg.ok ? 'acl-hint' : 'acl-error'} style={{ marginTop: 14 }}>{msg.text}</div>}
            <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
              <button className="btn-primary" onClick={() => void save()} disabled={saving || !valid || !meta?.migrated}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              {meta?.updated_at && (
                <span className="acl-muted">Last changed {new Date(meta.updated_at).toLocaleString()} by {meta.updated_by || '—'}</span>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
