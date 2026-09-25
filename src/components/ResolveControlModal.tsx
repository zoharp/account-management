'use client';

import { useEffect, useState } from 'react';
import ModalShell from './ModalShell';
import type { Iso27001ControlNote, Iso27001ControlRow, Iso27001RunControl, Iso27001Status } from '@/lib/types';
import { assessControl, PRIORITY_LABEL, PRIORITY_TOGGLE } from '@/lib/iso27001-guidance';

const STATUS_LABEL: Record<Iso27001Status, string> = {
  pass: 'Compliant',
  partial: 'Partial',
  fail: 'Gap',
  blocked: 'Blocked',
  not_applicable: 'N/A',
};

/**
 * Answer one ISO 27001 control the automated scan couldn't settle on its own
 * — "is it documented?", "do we have a signed DPA?" — with an optional link
 * to whatever proves it, and (optionally) your own read on what the status
 * should be. This never changes the scan's own `status`; it writes alongside
 * it, so the next `compliance-audit` run can't silently erase your answer,
 * and an operator always sees both the automated verdict and the human one.
 *
 * Every save — a comment that leaves the control open, or a resolution — is
 * appended to the control's history (sql/006), listed at the bottom.
 * Given a `snapshot` (a past run's row) the dialog is read-only and shows what
 * that run found instead of the current scan.
 */
export default function ResolveControlModal({
  control,
  snapshot = null,
  onClose,
  onResolved,
}: {
  control: Iso27001ControlRow;
  snapshot?: Iso27001RunControl | null;
  onClose: () => void;
  onResolved: (updated: Iso27001ControlRow) => void;
}) {
  const readOnly = snapshot !== null;
  const scan = snapshot ?? control;
  const assessment = assessControl(scan);

  const [answer, setAnswer] = useState(control.resolution_answer ?? '');
  const [link, setLink] = useState(control.resolution_evidence_link ?? '');
  const [resolvedStatus, setResolvedStatus] = useState<Iso27001Status | ''>(control.resolved_status ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [notes, setNotes] = useState<Iso27001ControlNote[] | null>(null);
  const [notesError, setNotesError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/iso27001/${control.id}/notes`, { cache: 'no-store' })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { notes?: Iso27001ControlNote[]; detail?: string };
        if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
        if (!cancelled) setNotes(data.notes ?? []);
      })
      .catch((e: unknown) => {
        if (!cancelled) setNotesError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [control.id]);

  async function submit(resolved: boolean) {
    if (!answer.trim()) {
      setError(resolved ? 'Answer the question before resolving — even a short "Yes, see X" is enough.' : 'Write a comment first.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/iso27001/${control.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resolution_answer: answer.trim(),
          resolution_evidence_link: link.trim() || null,
          resolved_status: resolvedStatus || null,
          resolved,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        control?: Iso27001ControlRow;
        detail?: string;
      };
      if (!res.ok || !data.control) {
        setError(data.detail || `HTTP ${res.status}`);
        setBusy(false);
        return;
      }
      onResolved(data.control);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <ModalShell title={`${control.control_id} — ${control.title}`} subtitle={control.theme} onClose={onClose}>
      <div className="acl-detail-body">
        <div className="acl-section">
          <h3 className="acl-section-title">{readOnly ? 'What that run found' : 'What the last scan found'}</h3>
          <p className="acl-hint">
            Status: <strong>{STATUS_LABEL[scan.status]}</strong>
            {scan.check_ids.length > 0 && <> · checks: {scan.check_ids.join(', ')}</>}
          </p>
          <p className="acl-hint">
            {scan.evidence || 'No specific finding recorded — this control has no automated check.'}
          </p>
          {!readOnly && control.last_checked && (
            <p className="acl-hint">Last checked {new Date(control.last_checked).toLocaleDateString()}.</p>
          )}
        </div>

        {assessment.priority && (
          <div className="acl-section">
            <h3 className="acl-section-title">
              How to fix{' '}
              <span className={`acl-toggle ${PRIORITY_TOGGLE[assessment.priority]}`} style={{ marginLeft: 6 }}>
                {PRIORITY_LABEL[assessment.priority]}
              </span>
            </h3>
            {assessment.recommendations.map((r) => (
              <div key={r.checkId || 'manual'} style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}>
                <p className="acl-hint" style={{ margin: 0 }}>
                  <span className={`acl-toggle ${PRIORITY_TOGGLE[r.priority]}`}>{PRIORITY_LABEL[r.priority]}</span>{' '}
                  <strong>{r.label}</strong>
                  {' · '}
                  {r.kind === 'procedure' ? 'procedure' : 'security'}
                  {' · '}
                  {STATUS_LABEL[r.status]}
                  {r.checkId && <span className="acl-muted"> · {r.checkId}</span>}
                </p>
                <p className="acl-hint" style={{ margin: '4px 0 0' }}>
                  {r.action}
                </p>
                <ol className="acl-hint" style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                  {r.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}

        {!readOnly && (
          <div className="acl-section">
            <h3 className="acl-section-title">Answer it</h3>

            <div className="acl-field-row">
              <label className="acl-label" htmlFor="acl-iso-answer">
                Your answer
              </label>
              <textarea
                id="acl-iso-answer"
                className="acl-textarea"
                rows={3}
                placeholder="e.g. Yes — this is documented in the InfoSec policy, section 4.2"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                disabled={busy}
              />
            </div>

            <div className="acl-field-row">
              <label className="acl-label" htmlFor="acl-iso-link">
                Evidence link
              </label>
              <input
                id="acl-iso-link"
                className="acl-input"
                placeholder="https:// (optional)"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                disabled={busy}
              />
            </div>

            <div className="acl-field-row">
              <label className="acl-label" htmlFor="acl-iso-status">
                Your status
              </label>
              <select
                id="acl-iso-status"
                className="acl-input"
                value={resolvedStatus}
                onChange={(e) => setResolvedStatus(e.target.value as Iso27001Status | '')}
                disabled={busy}
              >
                <option value="">Leave as scanned ({STATUS_LABEL[control.status]})</option>
                {(Object.keys(STATUS_LABEL) as Iso27001Status[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>

            {error && <div className="acl-error">{error}</div>}

            {control.resolved && (
              <p className="acl-hint acl-hint--ok">
                Resolved{control.resolved_at ? ` on ${new Date(control.resolved_at).toLocaleDateString()}` : ''}. Saving
                again keeps the earlier answer in the history below.
              </p>
            )}

            <div className="acl-actions">
              <button className="acl-btn-cancel" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button className="acl-btn-cancel" onClick={() => void submit(false)} disabled={busy}>
                {control.resolved ? 'Reopen with comment' : 'Save comment'}
              </button>
              <button className="btn-primary" onClick={() => void submit(true)} disabled={busy}>
                {busy ? 'Saving…' : 'Mark resolved'}
              </button>
            </div>
          </div>
        )}

        <div className="acl-section">
          <h3 className="acl-section-title">History</h3>
          {notesError ? (
            <p className="acl-hint acl-hint--warn">History unavailable: {notesError}</p>
          ) : notes === null ? (
            <p className="acl-hint">Loading…</p>
          ) : notes.length === 0 ? (
            <p className="acl-hint">Nothing saved on this control yet.</p>
          ) : (
            notes.map((n) => (
              <div key={n.id} style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}>
                <p className="acl-hint" style={{ margin: 0 }}>
                  <strong>{new Date(n.created_at).toLocaleString()}</strong>
                  {' · '}
                  {n.author_email ?? `user ${n.author_id ?? '?'}`}
                  {' · '}
                  <span className={`acl-toggle ${n.resolved ? 'acl-toggle--on' : 'acl-toggle--off'}`}>
                    {n.resolved ? 'Resolved' : 'Comment'}
                  </span>
                  {n.asserted_status && <> · status {STATUS_LABEL[n.asserted_status]}</>}
                </p>
                <p className="acl-hint" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>
                  {n.answer}
                </p>
                {n.evidence_link && (
                  <p className="acl-hint" style={{ margin: '4px 0 0' }}>
                    <a href={n.evidence_link} target="_blank" rel="noopener noreferrer">
                      {n.evidence_link}
                    </a>
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </ModalShell>
  );
}
