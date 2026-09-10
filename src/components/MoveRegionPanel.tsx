'use client';

import { useState } from 'react';
import { DATA_REGIONS, REGION_LABELS, coerceRegion } from '@/lib/regions';
import type { DataRegion, MergedAccountRow } from '@/lib/types';

/**
 * Move one customer's data to another region.
 *
 * This is the **only** sanctioned way `accounts.region` ever changes — the PATCH
 * route refuses the field, because setting it moves nothing and would just record
 * the customer as living somewhere they do not. Here the field is updated at the
 * end, after the rows have actually arrived.
 *
 * ## Why the confirmation is heavier than a normal one
 *
 * The last step of the move deletes the source copy, and that copy contains quiz
 * attempts — somebody's exam record, the one thing Orcanos cannot rebuild. The
 * server verifies row counts before it deletes anything, so the dangerous
 * outcome is not "data lost" but "operator moved the wrong customer". Typing the
 * tenant name is what makes you read WHICH one is selected.
 *
 * The panel is also honest about the two things a move costs even when it works:
 * everyone signed in to that region is signed out, and an Ask Paul customer's
 * vector database does not travel.
 */
export default function MoveRegionPanel({
  row,
  onMoved,
}: {
  row: MergedAccountRow;
  onMoved: () => void;
}) {
  const current = row.region ? coerceRegion(row.region) : null;
  const others = DATA_REGIONS.filter((r) => r !== current);

  const [to, setTo] = useState<DataRegion>(others[0] ?? 'eu');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ steps: string[]; warning?: string } | null>(null);

  const armed = Boolean(row.tenant) && typed.trim().toLowerCase() === row.tenant?.toLowerCase();

  async function move() {
    if (!armed) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/accounts/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant: row.tenant, to_region: to, account_id: row.id }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        detail?: string;
        steps?: string[];
        warning?: string;
      };
      if (!res.ok) {
        setError(data.detail || `HTTP ${res.status}`);
        setResult(data.steps ? { steps: data.steps } : null);
      } else {
        setResult({ steps: data.steps ?? [], warning: data.warning });
        setTyped('');
        onMoved();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  // A tenant with no traceability presence has nothing to move — the account is
  // a master record only, and `accounts.region` alone is not data in a region.
  if (!row.tenant) {
    return (
      <div className="acl-section">
        <h3 className="acl-section-title">Move to another region</h3>
        <p className="acl-hint">
          This account has no Orcanos tenant, so it holds no data in any regional instance and
          there is nothing to move.
        </p>
      </div>
    );
  }

  return (
    <div className="acl-section">
      <h3 className="acl-section-title">Move to another region</h3>

      <p className="acl-hint">
        Moves every panel, snapshot, quiz and quiz attempt this customer has to the chosen region,
        then deletes the copy left behind. The server compares row counts before it deletes
        anything — if the target came up short, the move stops and the source is untouched.
      </p>

      <div className="acl-field-row">
        <label className="acl-label" htmlFor="acl-move-to">
          Move to
        </label>
        <select
          id="acl-move-to"
          className="acl-input"
          value={to}
          onChange={(e) => setTo(e.target.value as DataRegion)}
          disabled={busy}
        >
          {others.map((r) => (
            <option key={r} value={r}>
              {REGION_LABELS[r].label}
            </option>
          ))}
        </select>
      </div>

      <p className="acl-hint acl-hint--warn">
        <strong>Two things this costs even when it succeeds.</strong> Everyone signed in to{' '}
        {current ? REGION_LABELS[current].label : 'the current region'} is signed out and must sign
        in again at the new address. And if this customer uses <strong>Ask Paul</strong>, its
        vector database is a Supabase project, which cannot be moved between regions — it needs a
        new project and a re-index before the move counts as complete for GDPR.
      </p>

      <div className="acl-field-row">
        <label className="acl-label" htmlFor="acl-move-confirm">
          Type <code>{row.tenant}</code> to confirm
        </label>
        <input
          id="acl-move-confirm"
          className="acl-input"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={row.tenant}
          autoComplete="off"
          disabled={busy}
        />
      </div>

      {error && <div className="acl-error">{error}</div>}

      {result && (
        <div className={error ? 'acl-hint' : 'acl-hint acl-hint--ok'}>
          {result.steps.length > 0 && (
            <>
              <strong>What happened:</strong>
              <ol className="acl-steps">
                {result.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </>
          )}
          {result.warning && <p className="acl-hint--warn">{result.warning}</p>}
        </div>
      )}

      <button className="btn-primary" disabled={!armed || busy} onClick={() => void move()}>
        {busy
          ? 'Moving… this can take a few minutes'
          : `Move to ${REGION_LABELS[to].label}`}
      </button>
    </div>
  );
}
