'use client';

import { useCallback, useEffect, useState } from 'react';
import Check from './Check';
import { on, type TraceRow, type TraceSettingsResponse } from '@/lib/trace-ui';

/**
 * The Traceability tab — what the traceability-matrix app does for this tenant,
 * and nothing else.
 *
 * ## What left, and why
 *
 * This was one dialog holding four unrelated things: traceability's own access
 * gates, the **Ask Paul** licence, the per-tenant **AI engine**, and that
 * tenant's **AI spend**. Ask Paul is a different application with a different
 * database and a different sign-in; an operator reading this screen had to know
 * that in order to know which half of it applied. Those three moved to the
 * *Ask Paul*, *LLM* and *Spend* tabs. What is left is one app's settings.
 *
 * ## The invariants that stay here
 *
 *  1. **An absent flag means ON** (`on()` in `lib/trace-ui.ts`). A row written
 *     before a column existed must not lose a capability because the column was
 *     added around it.
 *     **Except BOM**, which is opt-in: absent means OFF (`on(v, false)`).
 *  2. **At least one module.** An account with none of Traceability, Training
 *     or BOM can sign in and reach nothing, which reads as a broken app rather than a
 *     licensing decision. Refused here and again by the route.
 *
 * The PUT is partial by design — it falls back to the stored row for every field
 * the payload omits — so this tab saves only its own flags and cannot disturb the
 * Ask Paul licence that the Ask Paul tab owns.
 */
export default function TraceabilityPanel({
  tenant,
  onSaved,
}: {
  tenant: string;
  /** Something changed; the account list should reload. */
  onSaved: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [row, setRow] = useState<TraceRow | null>(null);
  const [supportsModules, setSupportsModules] = useState(false);
  const [supportsBom, setSupportsBom] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'bad' | ''; text: string }>({
    kind: '',
    text: '',
  });

  const [allowAccess, setAllowAccess] = useState(true);
  const [allowAi, setAllowAi] = useState(false);
  const [allowAdd, setAllowAdd] = useState(true);
  const [allowTrace, setAllowTrace] = useState(true);
  const [allowTraining, setAllowTraining] = useState(true);
  const [allowBom, setAllowBom] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/accounts/trace/${encodeURIComponent(tenant)}`, {
        cache: 'no-store',
      });
      const data = (await res.json()) as TraceSettingsResponse;
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);

      setRow(data.row);
      setSupportsModules(data.supports_modules);
      setSupportsBom(Boolean(data.supports_bom));
      const r = data.row;
      setAllowAccess(r ? Boolean(r.allow_access) : true);
      setAllowAi(r ? Boolean(r.allow_ai) : false);
      setAllowAdd(on(r?.allow_add));
      setAllowTrace(on(r?.allow_trace));
      setAllowTraining(on(r?.allow_training));
      setAllowBom(on(r?.allow_bom, false));
      setNote(r?.note ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, [tenant]);

  useEffect(() => {
    void load();
  }, [load]);

  const noModule = !allowTrace && !allowTraining && !(supportsBom && allowBom);

  async function save() {
    if (noModule) {
      setStatus({ kind: 'bad', text: 'An account needs at least one module.' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/accounts/trace/${encodeURIComponent(tenant)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allow_access: allowAccess,
          allow_ai: allowAi,
          allow_add: allowAdd,
          // Omitted entirely on an instance without the columns — sending them
          // there succeeds and silently drops them, so the route refuses it.
          ...(supportsModules ? { allow_trace: allowTrace, allow_training: allowTraining } : {}),
          ...(supportsBom ? { allow_bom: allowBom } : {}),
          note,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { detail?: string };
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setStatus({ kind: 'ok', text: '✓ Saved' });
      onSaved();
      await load();
    } catch (e) {
      setStatus({ kind: 'bad', text: `✗ ${e instanceof Error ? e.message : String(e)}` });
    }
    setSaving(false);
  }

  if (loading) return <div className="acl-detail-body"><p className="acl-empty">Loading…</p></div>;
  if (error)
    return (
      <div className="acl-detail-body">
        <div className="acl-error">{error}</div>
      </div>
    );

  return (
    <div className="acl-detail-body">
      {!row && (
        <div className="acl-notice acl-notice--warn">
          <strong>Not in the traceability allowlist.</strong> Saving below adds <code>{tenant}</code>{' '}
          to it. While the allowlist has rows and this tenant is not one of them, its users are
          refused at sign-in.
        </div>
      )}

      <section className="acl-section">
        <h3 className="acl-section-title">Access</h3>
        <Check
          label="Can sign in"
          hint="Off: users are refused at login and existing sessions end on their next action."
          checked={allowAccess}
          onChange={setAllowAccess}
        />
        <Check
          label="AI features"
          hint="Generate with AI and Describe a panel, inside traceability. Hidden in the UI and refused server-side when off. Which model those calls use is on the LLM tab."
          checked={allowAi}
          onChange={setAllowAi}
        />
        <Check
          label="Add items"
          hint="Off makes the account effectively view-only: inline ＋ Add, drag-to-trace, Orphan Mode and Build with AI all disappear. A user's own Orcanos permission letters still apply on top."
          checked={allowAdd}
          onChange={setAllowAdd}
        />
      </section>

      <section className="acl-section">
        <h3 className="acl-section-title">Modules</h3>
        {supportsModules ? (
          <>
            <Check
              label="Traceability"
              hint="The L1→L6 matrix, panels, coverage, Trace Builder and Product Knowledge."
              checked={allowTrace}
              onChange={setAllowTrace}
            />
            <Check
              label="Training"
              hint="Training Traceability reports and the training surface."
              checked={allowTraining}
              onChange={setAllowTraining}
            />
            {supportsBom ? (
              <Check
                label="BOM"
                hint="The BOM viewer — Bill-of-Materials trees, where-used, costs. Off by default; customers do not see it until this is ticked. Its Orcanos filters are then set inside the module by an Orcanos administrator."
                checked={allowBom}
                onChange={setAllowBom}
              />
            ) : (
              <p className="acl-hint">
                BOM needs traceability-matrix 3.46.0 on this tenant&apos;s instance before it can be
                licensed.
              </p>
            )}
            {noModule && (
              <p className="acl-hint acl-hint--warn">
                An account needs at least one module — with none it can sign in and reach nothing.
              </p>
            )}
          </>
        ) : (
          <p className="acl-hint">
            This traceability instance predates per-module licences. Deploy 3.23.0 to manage them
            here — until then every listed account has both.
          </p>
        )}
        <p className="acl-hint">
          Ask Paul is licensed on its own tab. It is a separate application with its own database,
          not a module of this one.
        </p>
      </section>

      <section className="acl-section">
        <h3 className="acl-section-title">Note</h3>
        <input
          className="acl-search"
          style={{ width: '100%' }}
          value={note}
          placeholder="Internal note — never shown to the customer"
          onChange={(e) => setNote(e.target.value)}
        />
      </section>

      {status.text && (
        <p className={`acl-hint ${status.kind ? `acl-hint--${status.kind}` : ''}`}>{status.text}</p>
      )}

      <div className="acl-actions">
        <button className="btn-primary" onClick={() => void save()} disabled={saving || noModule}>
          {saving ? 'Saving…' : 'Save traceability settings'}
        </button>
      </div>
    </div>
  );
}
