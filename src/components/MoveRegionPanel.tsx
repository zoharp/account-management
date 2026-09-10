'use client';

import { useState } from 'react';
import { DATA_REGIONS, REGION_LABELS, coerceRegion } from '@/lib/regions';
import { MOVE_STEPS, type MoveEvent, type MoveStepKey } from '@/lib/move-steps';
import type { DataRegion, MergedAccountRow } from '@/lib/types';

type StepState = { status: 'pending' | 'running' | 'done' | 'failed'; note?: string };

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
 *
 * ## The checklist, and why it is not a percentage
 *
 * The move runs for minutes and the route streams NDJSON, one line per step
 * transition, so the list below tracks what the SERVER has actually passed. The
 * seven steps are rendered from the moment the button is armed — before the move
 * starts — because the operator is authorising a flow that ends in a delete and
 * ought to read the plan first.
 *
 * No bar and no timer. Export, import and purge are each a single opaque call to
 * a regional instance; nothing reports fractional progress, so a bar could only
 * be animated, and an animated bar on a destructive operation invites someone to
 * conclude it is stuck and reach for the reload. A step that stays *running* for
 * two minutes is telling the truth about where the time is going.
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
  const [warning, setWarning] = useState('');
  const [progress, setProgress] = useState<Partial<Record<MoveStepKey, StepState>>>({});
  const [succeeded, setSucceeded] = useState(false);

  const armed = Boolean(row.tenant) && typed.trim().toLowerCase() === row.tenant?.toLowerCase();
  const showChecklist = armed || busy || succeeded || Object.keys(progress).length > 0;

  function apply(event: MoveEvent) {
    if (event.t === 'step') {
      setProgress((p) => ({
        ...p,
        [event.key]: { status: event.status, note: 'note' in event ? event.note : undefined },
      }));
      return;
    }
    if (event.t === 'failed') {
      setError(event.detail);
      // Paint the step that broke, so the list and the message agree about where
      // it stopped. Everything after it stays pending — it never ran.
      if (event.key) {
        setProgress((p) => ({ ...p, [event.key!]: { ...p[event.key!], status: 'failed' } }));
      }
      return;
    }
    setSucceeded(true);
    setWarning(event.warning ?? '');
  }

  async function move() {
    if (!armed) return;
    setBusy(true);
    setError('');
    setWarning('');
    setSucceeded(false);
    setProgress({});
    try {
      const res = await fetch('/api/accounts/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant: row.tenant, to_region: to, account_id: row.id }),
      });

      // Two response shapes, on purpose. Everything the route could decide
      // BEFORE writing anything is ordinary JSON with a real status code; once
      // the move starts it is a stream, and the verdict is its last line — so
      // `res.ok` alone proves nothing here.
      const ndjson = (res.headers.get('content-type') ?? '').includes('ndjson');
      if (!ndjson || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { detail?: string };
        setError(data.detail || `HTTP ${res.status}`);
        setBusy(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sawTerminal = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let event: MoveEvent;
          try {
            event = JSON.parse(line) as MoveEvent;
          } catch {
            continue; // A torn line is not worth failing a move over.
          }
          if (event.t === 'done' || event.t === 'failed') sawTerminal = true;
          apply(event);
        }
      }

      // A stream that ends without a verdict is the dangerous case: the function
      // was cut off mid-move and the steps below are all that is known.
      if (!sawTerminal) {
        setError(
          `The connection ended before the move reported a result. Do NOT re-run it blindly — ` +
            `check which steps below completed, and whether '${row.tenant}' now exists in both ` +
            `regions, before doing anything else.`,
        );
      }
      // The list is refreshed either way: a failure part-way through still moved
      // the account's region, or its access flag, or both.
      onMoved();
      if (sawTerminal) setTyped('');
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

      {showChecklist && (
        <ol className="acl-move-steps">
          {MOVE_STEPS.map((step) => {
            const state = progress[step.key]?.status ?? 'pending';
            return (
              <li key={step.key} className={`acl-move-step acl-move-step--${state}`}>
                <span className="acl-move-step-mark" aria-hidden="true">
                  {state === 'done' ? '✓' : state === 'failed' ? '✕' : state === 'running' ? '●' : '○'}
                </span>
                <span className="acl-move-step-body">
                  <span className="acl-move-step-label">{step.label}</span>
                  {progress[step.key]?.note && (
                    <span className="acl-move-step-note">{progress[step.key]!.note}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {error && <div className="acl-error">{error}</div>}

      {succeeded && (
        <div className="acl-hint acl-hint--ok">
          <strong>Move complete.</strong> {row.tenant} now lives in {REGION_LABELS[to].label}.
        </div>
      )}
      {warning && <p className="acl-hint acl-hint--warn">{warning}</p>}

      <button className="btn-primary" disabled={!armed || busy} onClick={() => void move()}>
        {busy
          ? 'Moving… this can take a few minutes'
          : `Move to ${REGION_LABELS[to].label}`}
      </button>
    </div>
  );
}
