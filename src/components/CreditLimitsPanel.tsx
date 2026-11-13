'use client';

import { useCallback, useEffect, useState } from 'react';
import CreditMeters from './CreditMeters';
import {
  CREDIT_PERIODS,
  fmtCredits,
  validateCreditLimits,
  type CreditLimits,
  type CreditPeriod,
  type CreditUsage,
} from '@/lib/credit-limits-key';

type Draft = Record<CreditPeriod, string>;
const toDraft = (l: CreditLimits): Draft => ({ day: String(l.day), week: String(l.week), month: String(l.month) });

/**
 * The account window's *Credit limits* tab: use the default limits, or this account's own; and what
 * it has used — the same bars the customer sees. Keyed on `tenantKey` (= `kindKeyOf(row)`).
 */
export default function CreditLimitsPanel({
  tenantKey,
  accountId,
  hasTrace,
  region,
}: {
  tenantKey: string;
  accountId: string | null;
  hasTrace: boolean;
  region: string | null;
}) {
  const [defaults, setDefaults] = useState<CreditLimits | null>(null);
  const [own, setOwn] = useState<CreditLimits | null>(null);
  const [follow, setFollow] = useState(true);
  const [draft, setDraft] = useState<Draft>({ day: '', week: '', month: '' });
  const [usage, setUsage] = useState<CreditUsage | null>(null);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ tenant: tenantKey, region: region || 'us', trace: hasTrace ? '1' : '0' });
      if (accountId) q.set('account_id', accountId);
      const res = await fetch(`/api/accounts/credit-limits?${q}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setDefaults(data.defaults);
      setOwn(data.own?.limits ?? null);
      setFollow(!data.own);
      setDraft(toDraft(data.own?.limits ?? data.defaults));
      setUsage(data.usage);
      setNote(data.usage_note || '');
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }, [tenantKey, accountId, hasTrace, region]);
  useEffect(() => void load(), [load]);

  const parsed = validateCreditLimits(draft);
  const valid = typeof parsed !== 'string';

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/accounts/credit-limits', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant: tenantKey, limits: follow ? null : parsed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setMsg({ ok: true, text: follow ? 'This account now uses the default limits.' : 'Own limits saved.' });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
    setSaving(false);
  }

  if (!defaults) return <div className="acl-detail-body">{msg ? <div className="acl-error">{msg.text}</div> : <p className="acl-empty">Loading…</p>}</div>;

  const dirty = follow ? own !== null : !valid || own === null || CREDIT_PERIODS.some((p) => own[p.key] !== parsed[p.key]);

  return (
    <div className="acl-detail-body">
      <div className="acl-section">
        <div className="cl-card-head">
          <div>
            <h3 className="acl-section-title" style={{ margin: 0 }}>Credit limits</h3>
            <p className="acl-hint" style={{ margin: '4px 0 0' }}>
              AI in Ask Paul and Traceability stops for this account when any limit is reached. 0 = no limit.
            </p>
          </div>
          <label className="cl-follow">
            <input
              type="checkbox"
              checked={follow}
              onChange={(e) => {
                setFollow(e.target.checked);
                if (!e.target.checked) setDraft(toDraft(own ?? defaults));
              }}
            />
            Use default limits
          </label>
        </div>
        <div className="cl-limits">
          {CREDIT_PERIODS.map(({ key, label }) => (
            <div className="cl-limit" key={key}>
              <label className="acl-label" htmlFor={`cl-own-${key}`}>{label}</label>
              <input
                id={`cl-own-${key}`}
                className="acl-input cl-limit-input"
                type="number"
                min={0}
                step={100}
                disabled={follow}
                value={follow ? String(defaults[key]) : draft[key]}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              />
              <span className="acl-muted">{(follow ? defaults[key] : Number(draft[key])) > 0 ? 'credits' : 'No limit'}</span>
            </div>
          ))}
        </div>
        {!follow && !valid && <div className="acl-error" style={{ marginTop: 10 }}>{parsed}</div>}
        {msg && <div className={msg.ok ? 'acl-hint acl-hint--ok' : 'acl-error'} style={{ marginTop: 10 }}>{msg.text}</div>}
        <div className="cl-actions">
          <span className="acl-muted">
            {own
              ? 'Own limits — kept when the default changes, unless you choose to switch it back.'
              : `Default (${CREDIT_PERIODS.map((p) => fmtCredits(defaults[p.key])).join(' / ')}) — follows changes to the default.`}
          </span>
          <span style={{ flex: 1 }} />
          <button className="btn-primary" disabled={!dirty || saving || (!follow && !valid)} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="acl-section">
        <h3 className="acl-section-title">Used now</h3>
        {usage ? <CreditMeters usage={usage} /> : <p className="acl-empty">No usage available.</p>}
        {note && <p className="acl-hint acl-hint--warn">{note}</p>}
      </div>
    </div>
  );
}
