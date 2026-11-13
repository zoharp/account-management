'use client';

import { CREDIT_PERIODS, fmtCredits, type CreditUsage } from '@/lib/credit-limits-key';

/**
 * Today / this week / this month as bars — the combined total, split by app (Ask Paul, Traceability).
 * The same picture the customer sees in Ask Paul and in Traceability (Settings › Credit usage).
 * Amber outline at 80 %, red at 100 %. A limit of 0 = no limit (empty bar, "No limit").
 */
export default function CreditMeters({ usage }: { usage: CreditUsage }) {
  const resetText = (iso: string) => {
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return 'Resets now';
    const h = Math.floor(ms / 3_600_000);
    if (h < 24) return `Resets in ${h} h ${Math.floor((ms % 3_600_000) / 60_000)} m`;
    return `Resets ${new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}`;
  };

  return (
    <div className="cl-meters">
      {CREDIT_PERIODS.map(({ key, title }) => {
        const L = usage.limits[key];
        const used = usage.used[key];
        const pct = L > 0 ? Math.min(100, (used / L) * 100) : 0;
        const state = L > 0 && used >= L ? 'bad' : pct >= 80 ? 'warn' : '';
        const scale = L > 0 ? Math.min(1, L / Math.max(used, 1)) : 0;
        const ap = L > 0 ? (usage.by_app.ask_paul[key] / L) * 100 * scale : 0;
        const tr = L > 0 ? (usage.by_app.traceability[key] / L) * 100 * scale : 0;
        return (
          <div className="cl-meter" key={key}>
            <div className="cl-meter-label">
              <b>{title}</b>
              <span>{resetText(usage.resets_at[key])}</span>
            </div>
            <div
              className={`cl-bar${state ? ` cl-bar--${state}` : ''}`}
              role="progressbar"
              aria-label={title}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(pct)}
              title={`Ask Paul ${fmtCredits(usage.by_app.ask_paul[key])} · Traceability ${fmtCredits(usage.by_app.traceability[key])}`}
            >
              <i className="cl-seg cl-seg--ap" style={{ width: `${ap}%` }} />
              <i className="cl-seg cl-seg--tr" style={{ width: `${tr}%` }} />
            </div>
            <div className="cl-meter-val">
              <b>{L > 0 ? `${Math.round(pct)}%` : '—'}</b>
              <span>
                {fmtCredits(used)} / {L > 0 ? fmtCredits(L) : 'No limit'}
              </span>
            </div>
          </div>
        );
      })}
      <div className="cl-legend">
        <span><i className="cl-seg--ap" />Ask Paul</span>
        <span><i className="cl-seg--tr" />Traceability</span>
        <span>
          Today: Ask Paul {fmtCredits(usage.by_app.ask_paul.day)} · Traceability {fmtCredits(usage.by_app.traceability.day)}
        </span>
      </div>
    </div>
  );
}
