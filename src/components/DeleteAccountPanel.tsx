'use client';

import { useState } from 'react';
import type { MergedAccountRow } from '@/lib/types';

interface DeleteStep {
  step: string;
  ok: boolean;
  detail: string;
}

/**
 * Delete the account and everything it owns — `POST /api/accounts/delete`.
 *
 * Behind a disclosure and a typed `DELETE`, because unlike every other control
 * in this window it cannot be undone: the traceability data (including quiz
 * attempts) and the Supabase project are destroyed, not detached. The audit log
 * is kept.
 *
 * A partial failure leaves the account in the list (the master row is deleted
 * last), so the answer to a red step is to run it again.
 */
export default function DeleteAccountPanel({
  row,
  onDeleted,
  onClose,
}: {
  row: MergedAccountRow;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [steps, setSteps] = useState<DeleteStep[]>([]);
  const [warning, setWarning] = useState('');

  const armed = typed.trim() === 'DELETE';

  async function remove() {
    if (!armed) return;
    setBusy(true);
    setError('');
    setSteps([]);
    setWarning('');
    try {
      const res = await fetch('/api/accounts/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: row.id ?? null, tenant: row.tenant ?? null, confirm: 'DELETE' }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        detail?: string;
        success?: boolean;
        steps?: DeleteStep[];
        warning?: string;
      };
      setSteps(d.steps ?? []);
      setWarning(d.warning ?? '');
      if (!res.ok || !d.success) {
        throw new Error(d.detail || 'The delete stopped part-way. Nothing after the failed step was touched — run it again.');
      }
      onDeleted();
      if (!d.warning) onClose();
      else setBusy(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="acl-section">
        <button className="acl-disclosure acl-disclosure--danger" onClick={() => setOpen(true)}>
          Delete this account…
        </button>
      </div>
    );
  }

  return (
    <div className="acl-section acl-section--danger">
      <h3 className="acl-section-title">Delete {row.account_name}</h3>
      <p className="acl-hint acl-hint--warn">
        This permanently deletes <strong>everything</strong> for this account, and it cannot be undone:
      </p>
      <ul className="acl-steps">
        {row.tenant && (
          <li>
            all traceability data for tenant <code>{row.tenant}</code> — panels, users, training and quiz
            records, AI settings and its access row
          </li>
        )}
        {row.id && (
          <>
            <li>its Ask Paul Supabase project — documents, chat history, usage</li>
            <li>its master record, database credentials, LLM key, sign-in methods and cost history</li>
          </>
        )}
      </ul>
      <p className="acl-hint">The security audit log is kept, and records this delete.</p>

      <div className="acl-field-row">
        <label className="acl-label" htmlFor="acl-del-all">
          Type <code>DELETE</code> to confirm
        </label>
        <input
          id="acl-del-all"
          className="acl-input"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="DELETE"
          autoComplete="off"
          disabled={busy}
        />
      </div>

      {steps.length > 0 && (
        <ol className="acl-move-steps">
          {steps.map((s) => (
            <li key={s.step} className={`acl-move-step acl-move-step--${s.ok ? 'done' : 'failed'}`}>
              <span className="acl-move-step-mark" aria-hidden="true">
                {s.ok ? '✓' : '✕'}
              </span>
              <span className="acl-move-step-body">
                <span className="acl-move-step-label">{s.step}</span>
                <span className="acl-move-step-note">{s.detail}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {error && <div className="acl-error">{error}</div>}
      {warning && <p className="acl-hint acl-hint--warn">{warning}</p>}

      <div className="acl-inline-actions">
        <button className="acl-btn-cancel" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
        <button className="btn-danger-sm" disabled={!armed || busy} onClick={() => void remove()}>
          {busy ? 'Deleting…' : `Delete ${row.account_name} permanently`}
        </button>
      </div>
    </div>
  );
}
