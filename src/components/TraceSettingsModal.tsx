'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Everything the traceability-matrix `/admin` page can do to one account,
 * brought into the platform console: the access gates, the module licences,
 * the per-tenant AI engine, and that tenant's AI spend.
 *
 * Shapes mirrored from that app rather than reinvented, so the two stay
 * diffable while both exist. Four behaviours are load-bearing:
 *
 *  1. **An absent flag means ON.** A row written before a column existed reads
 *     as undefined, which `access_control._modules_of` treats as licensed. An
 *     account must never lose a capability because a column was added around it.
 *  2. **A blank key field means "keep the stored key".** Clearing is a separate,
 *     explicit tick. Collapsing the two silently downgrades a tenant to the
 *     server's shared key.
 *  3. **The key is verified before it is saved.** A bad AI key is invisible
 *     until a customer's generate button fails.
 *  4. **At least one module.** An account with none can sign in and reach
 *     nothing, which reads as a broken app rather than a licensing decision.
 */

interface TraceRow {
  account: string;
  allow_access: number;
  allow_ai: number;
  allow_add?: number;
  allow_trace?: number;
  allow_training?: number;
  allow_ask_paul?: number;
  ask_paul_account?: string;
  note?: string;
  updated_at?: string;
  ai_cost_usd?: number;
  ai_calls?: number;
  ai_provider?: string;
  ai_model?: string;
  ai_has_key?: boolean;
}

interface Engine {
  catalog: {
    providers: Array<{ key: string; label: string }>;
    models: Record<string, string[]>;
    default_model: Record<string, string>;
    bedrock_env_key_present: boolean;
  };
  global_default: { provider: string; model: string; has_key: boolean };
}

interface UsageRow {
  created_at: string;
  user_id: string;
  source_label?: string;
  source: string;
  model: string;
  total_tokens: number;
  cost_usd: number;
  ok: number;
}

/** An absent flag is ON — see note 1 above. */
const on = (v: number | undefined, fallback = true) => (v === undefined ? fallback : Boolean(v));

export default function TraceSettingsModal({
  tenant,
  accountName,
  onClose,
  onSaved,
}: {
  tenant: string;
  accountName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [row, setRow] = useState<TraceRow | null>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [supportsModules, setSupportsModules] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'bad' | ''; text: string }>({
    kind: '',
    text: '',
  });

  // Access + module flags
  const [allowAccess, setAllowAccess] = useState(true);
  const [allowAi, setAllowAi] = useState(false);
  const [allowAdd, setAllowAdd] = useState(true);
  const [allowTrace, setAllowTrace] = useState(true);
  const [allowTraining, setAllowTraining] = useState(true);
  const [allowAskPaul, setAllowAskPaul] = useState(true);
  const [askPaulAccount, setAskPaulAccount] = useState('');
  const [masterName, setMasterName] = useState<string | null>(null);
  const [note, setNote] = useState('');

  // AI engine
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [verified, setVerified] = useState(false);
  const [testing, setTesting] = useState(false);

  // Usage
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [usageTotals, setUsageTotals] = useState<{ cost: number; calls: number } | null>(null);
  const [usageOpen, setUsageOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/accounts/trace/${encodeURIComponent(tenant)}`, {
        cache: 'no-store',
      });
      const data = (await res.json()) as {
        row: TraceRow | null;
        engine: Engine | null;
        supports_modules: boolean;
        master_account_name: string | null;
        detail?: string;
      };
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);

      setRow(data.row);
      setEngine(data.engine);
      setSupportsModules(data.supports_modules);
      setMasterName(data.master_account_name);

      const r = data.row;
      setAllowAccess(r ? Boolean(r.allow_access) : true);
      setAllowAi(r ? Boolean(r.allow_ai) : false);
      setAllowAdd(on(r?.allow_add));
      setAllowTrace(on(r?.allow_trace));
      setAllowTraining(on(r?.allow_training));
      setAllowAskPaul(on(r?.allow_ask_paul));
      setAskPaulAccount(r?.ask_paul_account ?? '');
      setNote(r?.note ?? '');
      setProvider(r?.ai_provider ?? '');
      setModel(r?.ai_model ?? '');
      setApiKey('');
      setClearKey(false);
      setVerified(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, [tenant]);

  useEffect(() => {
    void load();
  }, [load]);

  // Any edit to provider, model or key invalidates a green tick — otherwise a
  // pass on the previous value would authorise saving a different one. Same
  // rule the vector-key editor already follows.
  useEffect(() => {
    setVerified(false);
    setStatus({ kind: '', text: '' });
  }, [provider, model, apiKey, clearKey]);

  const models = engine?.catalog.models[provider] ?? [];
  const defaultModel = engine?.catalog.default_model[provider] ?? '';
  const noModule = !allowTrace && !allowTraining;

  /** null = keep the stored key · '' = clear it · other = set it. */
  function keyArg(): string | null {
    if (clearKey) return '';
    const v = apiKey.trim();
    return v ? v : null;
  }

  async function saveFlags() {
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
          ...(supportsModules ? { allow_trace: allowTrace, allow_training: allowTraining } : {}),
          allow_ask_paul: allowAskPaul,
          ask_paul_account: askPaulAccount,
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

  async function runTest(): Promise<boolean> {
    setTesting(true);
    setStatus({
      kind: '',
      text: provider ? 'Testing the model with this key…' : 'Testing the server’s default key…',
    });
    try {
      const res = await fetch(`/api/accounts/trace/${encodeURIComponent(tenant)}/ai-config/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model, api_key: keyArg() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        detail?: string;
      };
      if (res.ok && data.ok) {
        setVerified(true);
        setStatus({ kind: 'ok', text: `✓ ${data.message || 'Key verified.'}` });
        return true;
      }
      setVerified(false);
      setStatus({ kind: 'bad', text: `✗ ${data.message || data.detail || 'The key did not work.'}` });
      return false;
    } catch (e) {
      setVerified(false);
      setStatus({ kind: 'bad', text: `✗ ${e instanceof Error ? e.message : String(e)}` });
      return false;
    } finally {
      setTesting(false);
    }
  }

  async function saveEngine() {
    // Resetting to the server default needs no key, so it needs no test.
    if (provider && !verified) {
      const ok = await runTest();
      if (!ok) return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/accounts/trace/${encodeURIComponent(tenant)}/ai-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: provider ? model : '',
          api_key: provider ? keyArg() : null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { detail?: string };
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setStatus({ kind: 'ok', text: '✓ AI engine saved' });
      onSaved();
      await load();
    } catch (e) {
      setStatus({ kind: 'bad', text: `✗ ${e instanceof Error ? e.message : String(e)}` });
    }
    setSaving(false);
  }

  async function loadUsage() {
    setUsageOpen(true);
    try {
      const res = await fetch(`/api/accounts/trace/${encodeURIComponent(tenant)}/usage?limit=200`, {
        cache: 'no-store',
      });
      const data = (await res.json()) as {
        rows?: UsageRow[];
        total_cost_usd?: number;
        total_calls?: number;
        detail?: string;
      };
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setUsage(data.rows ?? []);
      setUsageTotals({ cost: data.total_cost_usd ?? 0, calls: data.total_calls ?? 0 });
    } catch (e) {
      setStatus({ kind: 'bad', text: `✗ ${e instanceof Error ? e.message : String(e)}` });
      setUsageOpen(false);
    }
  }

  return (
    <div className="acl-overlay" onClick={onClose}>
      <div className="acl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="acl-header">
          <h2>
            Traceability — {accountName}
            {accountName.toLowerCase() !== tenant && (
              <span className="acl-header-sub">
                tenant <code>{tenant}</code>
              </span>
            )}
          </h2>
          <button className="acl-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="acl-detail-body">
          {loading ? (
            <p className="acl-empty">Loading…</p>
          ) : error ? (
            <div className="acl-error">{error}</div>
          ) : (
            <>
              {!row && (
                <div className="acl-notice acl-notice--warn">
                  <strong>Not in the traceability allowlist.</strong> Saving below adds{' '}
                  <code>{tenant}</code> to it. While the allowlist has rows and this tenant is not
                  one of them, its users are refused at sign-in.
                </div>
              )}

              {/* ── Access ─────────────────────────────────────────────── */}
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
                  hint="Generate with AI and Describe a panel. Hidden in the UI and refused server-side when off."
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

              {/* ── Modules ────────────────────────────────────────────── */}
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
                    {noModule && (
                      <p className="acl-hint acl-hint--warn">
                        An account needs at least one module — with none it can sign in and reach
                        nothing.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="acl-hint">
                    This traceability instance predates per-module licences. Deploy 3.23.0 to manage
                    them here — until then every listed account has both.
                  </p>
                )}
              </section>

              {/* ── Ask Paul (QMS AI) ──────────────────────────────────── */}
              <section className="acl-section">
                <h3 className="acl-section-title">Ask Paul (QMS AI)</h3>
                <Check
                  label="Ask Paul"
                  hint="The hand-off button into the QMS AI app. Off hides it and 403s the SSO endpoint."
                  checked={allowAskPaul}
                  onChange={setAllowAskPaul}
                />

                <label className="acl-field-row acl-field-row--stack">
                  <span>Account name inside Ask Paul</span>
                  <input
                    value={askPaulAccount}
                    placeholder={`blank — sends the tenant name “${tenant}”`}
                    onChange={(e) => setAskPaulAccount(e.target.value)}
                  />
                </label>

                {/* The whole reason this field exists: QMS AI routes on
                    `account_name`, which is a label ("Medical Portal"), while
                    traceability routes on the Orcanos tenant ("orca60"). The
                    trace app cannot see the master DB, so it keeps its own copy
                    here — and a copy can be wrong. This console can read both,
                    so it is the only place the mismatch is visible. */}
                {masterName ? (
                  askPaulAccount.trim().toLowerCase() === masterName.toLowerCase() ? (
                    <p className="acl-hint acl-hint--ok">
                      ✓ Matches the master account name.
                    </p>
                  ) : (
                    <p className="acl-hint acl-hint--warn">
                      In the master database this tenant is{' '}
                      <strong>{masterName}</strong>
                      {askPaulAccount.trim()
                        ? ' — the value above does not match, so the hand-off will land on the wrong account or fail.'
                        : ` — blank sends “${tenant}”, which QMS AI will not recognise.`}{' '}
                      <button
                        type="button"
                        className="acl-cost-link"
                        onClick={() => setAskPaulAccount(masterName)}
                      >
                        Use “{masterName}”
                      </button>
                    </p>
                  )
                ) : (
                  <p className="acl-hint">
                    No master account is linked to this tenant, so there is no name to check
                    against. Leave blank unless Ask Paul knows it by a different name.
                  </p>
                )}
              </section>

              {/* ── Note ───────────────────────────────────────────────── */}
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

              <div className="acl-actions">
                <button className="btn-primary" onClick={() => void saveFlags()} disabled={saving || noModule}>
                  {saving ? 'Saving…' : 'Save access & modules'}
                </button>
              </div>

              {/* ── AI engine ──────────────────────────────────────────── */}
              <section className="acl-section">
                <h3 className="acl-section-title">AI engine</h3>
                <p className="acl-hint">
                  How AI runs for this tenant inside traceability — panel-describe, trace-build and
                  duplicate scoring. Separate from the QMS AI key, which drives RAG and chat.
                  {engine?.global_default.provider ? (
                    <>
                      {' '}
                      Unconfigured accounts inherit the global default (
                      <code>{engine.global_default.provider}</code>
                      {engine.global_default.model ? <> · {engine.global_default.model}</> : null}).
                    </>
                  ) : null}
                </p>

                <label className="acl-field-row acl-field-row--stack">
                  <span>Provider</span>
                  <select value={provider} onChange={(e) => setProvider(e.target.value)}>
                    {(engine?.catalog.providers ?? [{ key: '', label: 'Default (server env)' }]).map(
                      (p) => (
                        <option key={p.key} value={p.key}>
                          {p.label}
                        </option>
                      ),
                    )}
                  </select>
                </label>

                {provider && (
                  <>
                    <label className="acl-field-row acl-field-row--stack">
                      <span>Model</span>
                      <select value={model} onChange={(e) => setModel(e.target.value)}>
                        {models.length === 0 && <option value="">(no catalog)</option>}
                        {models.map((m) => (
                          <option key={m} value={m}>
                            {m}
                            {m === defaultModel ? ' (default)' : ''}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="acl-field-row acl-field-row--stack">
                      <span>
                        {provider === 'bedrock' ? 'Bedrock gateway key' : 'Anthropic API key'}
                      </span>
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={apiKey}
                        disabled={clearKey}
                        placeholder={row?.ai_has_key ? '•••••••• stored' : ''}
                        onChange={(e) => setApiKey(e.target.value)}
                      />
                    </label>
                    <p className="acl-hint">
                      {row?.ai_has_key
                        ? 'A key is stored. Leave blank to keep it.'
                        : provider === 'bedrock'
                          ? engine?.catalog.bedrock_env_key_present
                            ? 'Leave blank to use the server’s shared gateway key.'
                            : 'No shared key on the server — enter the gateway key.'
                          : 'Leave blank to use the server’s ANTHROPIC_API_KEY.'}
                    </p>

                    {row?.ai_has_key && (
                      <Check
                        label="Clear the stored key"
                        hint="Falls back to the server’s environment key."
                        checked={clearKey}
                        onChange={setClearKey}
                      />
                    )}
                  </>
                )}

                {status.text && (
                  <p className={`acl-hint ${status.kind ? `acl-hint--${status.kind}` : ''}`}>
                    {status.text}
                  </p>
                )}

                <div className="acl-actions">
                  <button className="btn-sm" onClick={() => void runTest()} disabled={testing || saving}>
                    {testing ? 'Testing…' : 'Test'}
                  </button>
                  <button className="btn-primary" onClick={() => void saveEngine()} disabled={saving || testing}>
                    {provider && !verified ? 'Test & save engine' : 'Save engine'}
                  </button>
                </div>
              </section>

              {/* ── Spend ──────────────────────────────────────────────── */}
              <section className="acl-section">
                <h3 className="acl-section-title">Traceability AI spend</h3>
                <p className="acl-hint">
                  ${Number(row?.ai_cost_usd ?? 0).toFixed(4)} over {row?.ai_calls ?? 0} call
                  {row?.ai_calls === 1 ? '' : 's'}. Lifetime — this ledger is separate from QMS AI’s.
                </p>
                {!usageOpen ? (
                  <button className="btn-sm" onClick={() => void loadUsage()} disabled={!row?.ai_calls}>
                    View calls
                  </button>
                ) : usage.length === 0 ? (
                  <p className="acl-empty">No calls recorded.</p>
                ) : (
                  <div className="acl-usage">
                    <table className="acl-table">
                      <thead>
                        <tr>
                          <th>When</th>
                          <th>User</th>
                          <th>Source</th>
                          <th>Model</th>
                          <th style={{ textAlign: 'right' }}>Tokens</th>
                          <th style={{ textAlign: 'right' }}>Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usage.map((u, i) => (
                          <tr key={i} className={u.ok ? undefined : 'acl-row--failed'}>
                            <td className="acl-muted">{u.created_at}</td>
                            <td className="acl-muted">{u.user_id || '—'}</td>
                            <td>{u.source_label || u.source || '—'}</td>
                            <td className="acl-muted">{u.model || '—'}</td>
                            <td className="acl-num acl-muted">
                              {Number(u.total_tokens || 0).toLocaleString()}
                            </td>
                            <td className="acl-num">${Number(u.cost_usd || 0).toFixed(4)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {usageTotals && (
                      <p className="acl-hint">
                        Showing {usage.length} of {usageTotals.calls} calls · lifetime $
                        {usageTotals.cost.toFixed(4)}
                      </p>
                    )}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Check({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="acl-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <strong>{label}</strong>
        <em>{hint}</em>
      </span>
    </label>
  );
}
