'use client';

import { useState } from 'react';
import ModalShell from './ModalShell';
import type { Iso27001ControlRow, Iso27001Status } from '@/lib/types';

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
 */
export default function ResolveControlModal({
  control,
  onClose,
  onResolved,
}: {
  control: Iso27001ControlRow;
  onClose: () => void;
  onResolved: (updated: Iso27001ControlRow) => void;
}) {
  const [answer, setAnswer] = useState(control.resolution_answer ?? '');
  const [link, setLink] = useState(control.resolution_evidence_link ?? '');
  const [resolvedStatus, setResolvedStatus] = useState<Iso27001Status | ''>(
    control.resolved_status ?? '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!answer.trim()) {
      setError('Answer the question before resolving — even a short "Yes, see X" is enough.');
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
          <h3 className="acl-section-title">What the last scan found</h3>
          <p className="acl-hint">
            {control.evidence || 'No specific finding recorded — this control has no automated check.'}
          </p>
          {control.last_checked && (
            <p className="acl-hint">Last checked {new Date(control.last_checked).toLocaleDateString()}.</p>
          )}
        </div>

        <div className="acl-section">
          <h3 className="acl-section-title">Resolve it</h3>

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
              Already resolved{control.resolved_at ? ` on ${new Date(control.resolved_at).toLocaleDateString()}` : ''}
              . Submitting again replaces that answer.
            </p>
          )}

          <div className="acl-actions">
            <button className="acl-btn-cancel" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="btn-primary" onClick={() => void submit()} disabled={busy}>
              {busy ? 'Saving…' : 'Mark resolved'}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
