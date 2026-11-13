'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CREDIT_PERIODS,
  fmtCredits,
  sameLimits,
  validateCreditLimits,
  type CreditLimits,
  type CreditPeriod,
} from '@/lib/credit-limits-key';

interface OwnRow {
  tenant: string;
  limits: CreditLimits;
  updated_at: string | null;
  updated_by: string | null;
}

type Draft = Record<CreditPeriod, string>;
const toDraft = (l: CreditLimits): Draft => ({ day: String(l.day), week: String(l.week), month: String(l.month) });
const limitText = (n: number) => (n > 0 ? fmtCredits(n) : 'No limit');

/**
 * Default AI credit limits (one place, every account) + the accounts that have their own.
 * Saving a change asks which of those accounts should be switched to the new default — every one
 * whose own limits differ is ticked; untick the ones to keep. Accounts with no limits of their own
 * follow the default automatically and are not listed.
 */
export default function CreditLimitsCard({ factor }: { factor: number | null }) {
  const [saved, setSaved] = useState<CreditLimits | null>(null);
  const [draft, setDraft] = useState<Draft>({ day: '', week: '', month: '' });
  const [own, setOwn] = useState<OwnRow[]>([]);
  const [meta, setMeta] = useState<{ updated_at: string | null; updated_by: string | null; migrated: boolean } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState<{ next: CreditLimits; ticked: Set<string> } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/credit-limits', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setSaved(data.defaults);
      setDraft(toDraft(data.defaults));
      setOwn(data.own ?? []);
      setMeta({ updated_at: data.updated_at, updated_by: data.updated_by, migrated: data.migrated });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }, []);
  useEffect(() => void load(), [load]);

  const parsed = validateCreditLimits(draft);
  const valid = typeof parsed !== 'string';
  const changed = valid && saved !== null && !sameLimits(parsed, saved);
  const differs = useMemo(
    () => (confirm ? own.filter((o) => !sameLimits(o.limits, confirm.next)) : []),
    [confirm, own],
  );

  function askToSave() {
    if (!valid) return;
    const next = parsed;
    const ticked = new Set(own.filter((o) => !sameLimits(o.limits, next)).map((o) => o.tenant));
    setConfirm({ next, ticked });
  }

  async function save() {
    if (!confirm) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/settings/credit-limits', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limits: confirm.next, reset_tenants: [...confirm.ticked] }),
      });
      const data = await res.json();
      if (!res.ok || res.status === 207) throw new Error(data.detail || `HTTP ${res.status}`);
      const n = confirm.ticked.size;
      setMsg({
        ok: true,
        text: `Default limits saved${n ? ` · ${n} account${n === 1 ? '' : 's'} switched to the default` : ''}. Ask Paul and Traceability pick it up within 30 seconds.`,
      });
      setConfirm(null);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
      setConfirm(null);
    }
    setSaving(false);
    await load();
  }

  const followCount = own.length;

  return (
    <div className="app-card" style={{ padding: 24, maxWidth: 820 }}>
      <div className="cl-card-head">
        <div>
          <h2 className="acl-section-title" style={{ margin: 0 }}>Default credit limits</h2>
          <p className="acl-hint" style={{ margin: '4px 0 0' }}>
            Every account without limits of its own uses these. When an account reaches any one of them, AI stops in
            Ask Paul and Traceability until that period resets. 0 = no limit. Periods are UTC: the day from 00:00, the
            week from Monday, the month from the 1st.
          </p>
        </div>
      </div>

      {meta && !meta.migrated && (
        <div className="acl-error" style={{ margin: '12px 0' }}>
          The master database has no <code>platform_settings</code> table — run <code>sql/008_platform_settings.sql</code>.
        </div>
      )}

      <div className="cl-limits">
        {CREDIT_PERIODS.map(({ key, label }) => {
          const n = Number(draft[key]);
          return (
            <div key={key} className={`cl-limit${saved && n !== saved[key] ? ' cl-limit--changed' : ''}`}>
              <label className="acl-label" htmlFor={`cl-def-${key}`}>{label}</label>
              <input
                id={`cl-def-${key}`}
                className="acl-input cl-limit-input"
                type="number"
                min={0}
                step={100}
                value={draft[key]}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              />
              <span className="acl-muted">
                {n > 0 ? (factor ? `≈ $${(n / factor).toLocaleString('en-US', { maximumFractionDigits: 2 })} of AI cost` : '') : 'No limit'}
              </span>
            </div>
          );
        })}
      </div>

      {!valid && <div className="acl-error" style={{ marginTop: 10 }}>{parsed}</div>}
      {msg && <div className={msg.ok ? 'acl-hint acl-hint--ok' : 'acl-error'} style={{ marginTop: 10 }}>{msg.text}</div>}

      <div className="cl-actions">
        <span className="acl-muted">
          {followCount === 0 ? 'Every account uses the default.' : `${followCount} account${followCount === 1 ? ' has' : 's have'} their own limits.`}
        </span>
        <span style={{ flex: 1 }} />
        <button className="acl-btn-cancel" disabled={!changed} onClick={() => saved && setDraft(toDraft(saved))}>Discard</button>
        <button className="btn-primary" disabled={!changed || saving || !meta?.migrated} onClick={askToSave}>Save defaults</button>
      </div>
      {meta?.updated_at && (
        <div className="acl-muted" style={{ marginTop: 6 }}>
          Last changed {new Date(meta.updated_at).toLocaleString()} by {meta.updated_by || '—'}
        </div>
      )}

      <h3 className="acl-section-title" style={{ marginTop: 22 }}>Accounts with their own limits</h3>
      {own.length === 0 ? (
        <p className="acl-empty">None. Set an account&apos;s own limits on its <em>Credit limits</em> tab.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="acl-table">
            <thead>
              <tr>
                <th>Account</th>
                {CREDIT_PERIODS.map((p) => <th key={p.key} className="acl-num">{p.label}</th>)}
                <th>Set by</th>
              </tr>
            </thead>
            <tbody>
              {own.map((o) => (
                <tr key={o.tenant}>
                  <td><code>{o.tenant}</code></td>
                  {CREDIT_PERIODS.map((p) => (
                    <td key={p.key} className={`acl-num${saved && o.limits[p.key] !== saved[p.key] ? ' cl-diff' : ''}`}>
                      {limitText(o.limits[p.key])}
                    </td>
                  ))}
                  <td className="acl-muted">
                    {o.updated_by || '—'}
                    {o.updated_at ? ` · ${new Date(o.updated_at).toLocaleDateString()}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirm && saved && (
        <div className="acl-overlay" onClick={() => !saving && setConfirm(null)}>
          <div className="acl-modal cl-confirm" role="dialog" aria-modal="true" aria-labelledby="cl-confirm-title" onClick={(e) => e.stopPropagation()}>
            <div className="acl-header">
              <div>
                <h2 id="cl-confirm-title">Apply the new defaults to accounts with their own limits?</h2>
                <span className="acl-header-sub cl-changes">
                  {CREDIT_PERIODS.filter((p) => confirm.next[p.key] !== saved[p.key]).map((p) => (
                    <span key={p.key}>
                      {p.label}: <s>{limitText(saved[p.key])}</s> → <b>{limitText(confirm.next[p.key])}</b>
                    </span>
                  ))}
                </span>
              </div>
              <button className="acl-close" onClick={() => setConfirm(null)} disabled={saving}>✕</button>
            </div>
            <div className="acl-detail-body">
              <p className="acl-hint" style={{ marginTop: 0 }}>
                Accounts without limits of their own get the new defaults automatically. The accounts below have their
                own limits that differ from the new defaults. Ticked ones are switched to the default; unticked ones
                keep their own limits.
              </p>
              {differs.length === 0 ? (
                <p className="acl-empty">No account has limits that differ from the new defaults.</p>
              ) : (
                <table className="acl-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          aria-label="Select all"
                          checked={differs.every((d) => confirm.ticked.has(d.tenant))}
                          onChange={(e) =>
                            setConfirm({ ...confirm, ticked: new Set(e.target.checked ? differs.map((d) => d.tenant) : []) })
                          }
                        />
                      </th>
                      <th>Account</th>
                      {CREDIT_PERIODS.map((p) => <th key={p.key} className="acl-num">{p.label} now</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {differs.map((d) => (
                      <tr key={d.tenant}>
                        <td>
                          <input
                            id={`cl-reset-${d.tenant}`}
                            type="checkbox"
                            checked={confirm.ticked.has(d.tenant)}
                            onChange={(e) => {
                              const t = new Set(confirm.ticked);
                              if (e.target.checked) t.add(d.tenant);
                              else t.delete(d.tenant);
                              setConfirm({ ...confirm, ticked: t });
                            }}
                          />
                        </td>
                        <td><label htmlFor={`cl-reset-${d.tenant}`}><code>{d.tenant}</code></label></td>
                        {CREDIT_PERIODS.map((p) => (
                          <td key={p.key} className={`acl-num${d.limits[p.key] !== confirm.next[p.key] ? ' cl-diff' : ''}`}>
                            {limitText(d.limits[p.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="cl-actions">
                <span className="acl-muted">
                  {confirm.ticked.size} switch to the default · {differs.length - confirm.ticked.size} keep their own
                </span>
                <span style={{ flex: 1 }} />
                <button className="acl-btn-cancel" onClick={() => setConfirm(null)} disabled={saving}>Cancel</button>
                <button className="btn-primary" onClick={() => void save()} disabled={saving}>
                  {saving ? 'Saving…' : 'Save defaults'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
