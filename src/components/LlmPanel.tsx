'use client';

import { useCallback, useEffect, useState } from 'react';
import Check from './Check';
import type { TraceEngine, TraceRow, TraceSettingsResponse } from '@/lib/trace-ui';
import type { LlmKeyStatus } from '@/lib/types';

/**
 * The LLM tab — which model runs for this customer, and on whose key.
 *
 * ## Why the two are on one tab
 *
 * This customer has **two independent AI configurations**, and they share
 * nothing but the word "AI":
 *
 *  - **Traceability's engine** — provider, model and key for panel-describe,
 *    trace-build and duplicate scoring. Stored on the trace allowlist row, and
 *    able to route to the Orcanos Bedrock gateway.
 *  - **Ask Paul's key** — `account_llm_keys` in the master database, driving QMS
 *    AI's RAG and chat.
 *
 * They were on opposite sides of the window: the engine buried at the bottom of
 * the Traceability dialog, the key a one-line badge in Account & databases. Two
 * settings that look like one setting in two places are exactly the thing to put
 * side by side — seeing both is the only way to notice that a tenant is running
 * Sonnet in one app and something else in the other.
 *
 * The engine editor keeps its two rules: **a blank key field means "keep the
 * stored key"** (clearing is a separate, explicit tick, because collapsing the
 * two silently downgrades a tenant to the server's shared key), and **the key is
 * verified before it is saved** (a bad key is invisible until a customer's
 * generate button fails).
 */
export default function LlmPanel({
  accountId,
  tenant,
  onSaved,
}: {
  accountId: string | null;
  tenant: string | null;
  onSaved: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [llmKey, setLlmKey] = useState<LlmKeyStatus | null>(null);
  const [row, setRow] = useState<TraceRow | null>(null);
  const [engine, setEngine] = useState<TraceEngine | null>(null);
  const [traceReachable, setTraceReachable] = useState(false);

  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [verified, setVerified] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'bad' | ''; text: string }>({
    kind: '',
    text: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [acct, trace] = await Promise.all([
        accountId
          ? fetch(`/api/accounts/${accountId}`, { cache: 'no-store' })
              .then(async (r) => (r.ok ? ((await r.json()) as { llm_key: LlmKeyStatus | null }) : null))
              .catch(() => null)
          : Promise.resolve(null),
        tenant
          ? fetch(`/api/accounts/trace/${encodeURIComponent(tenant)}`, { cache: 'no-store' })
              .then(async (r) => (r.ok ? ((await r.json()) as TraceSettingsResponse) : null))
              .catch(() => null)
          : Promise.resolve(null),
      ]);

      setLlmKey(acct?.llm_key ?? null);
      if (trace) {
        setTraceReachable(true);
        setRow(trace.row);
        setEngine(trace.engine);
        setProvider(trace.row?.ai_provider ?? '');
        setModel(trace.row?.ai_model ?? '');
        setApiKey('');
        setClearKey(false);
        setVerified(false);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, [accountId, tenant]);

  useEffect(() => {
    void load();
  }, [load]);

  // Any edit to provider, model or key invalidates a green tick — a pass on the
  // previous value must not authorise saving a different one. Same rule the
  // vector-key editor follows.
  useEffect(() => {
    setVerified(false);
    setStatus({ kind: '', text: '' });
  }, [provider, model, apiKey, clearKey]);

  const models = engine?.catalog.models[provider] ?? [];
  const defaultModel = engine?.catalog.default_model[provider] ?? '';

  /** null = keep the stored key · '' = clear it · other = set it. */
  function keyArg(): string | null {
    if (clearKey) return '';
    const v = apiKey.trim();
    return v ? v : null;
  }

  async function runTest(): Promise<boolean> {
    if (!tenant) return false;
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
    if (!tenant) return;
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

  if (loading) {
    return (
      <div className="acl-detail-body">
        <p className="acl-empty">Loading…</p>
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="acl-detail-body">
        <div className="acl-error">{loadError}</div>
      </div>
    );
  }

  return (
    <div className="acl-detail-body">
      {/* ── Traceability engine ───────────────────────────────────────────── */}
      <section className="acl-section">
        <h3 className="acl-section-title">Traceability AI engine</h3>

        {!tenant ? (
          <p className="acl-hint">
            This account has no Orcanos tenant, so it has no traceability row to configure an engine
            on.
          </p>
        ) : !traceReachable ? (
          <p className="acl-hint acl-hint--warn">
            The traceability instance is not reachable, so its engine cannot be read or changed right
            now.
          </p>
        ) : (
          <>
            <p className="acl-hint">
              Panel-describe, trace-build and duplicate scoring inside traceability. Whether those
              features are offered at all is the <em>AI features</em> gate on the{' '}
              <em>Traceability</em> tab; this is which model answers when they are.
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
                  <span>{provider === 'bedrock' ? 'Bedrock gateway key' : 'Anthropic API key'}</span>
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
              <button
                className="btn-primary"
                onClick={() => void saveEngine()}
                disabled={saving || testing}
              >
                {provider && !verified ? 'Test & save engine' : 'Save engine'}
              </button>
            </div>
          </>
        )}
      </section>

      {/* ── Ask Paul's key ────────────────────────────────────────────────── */}
      <section className="acl-section">
        <h3 className="acl-section-title">Ask Paul (QMS AI) key</h3>
        {!accountId ? (
          <p className="acl-hint">
            This tenant has no master account record, so it has no Ask Paul key.
          </p>
        ) : llmKey ? (
          <>
            <p className="acl-kv">
              <span className="acl-badge">{llmKey.engine}</span>{' '}
              <span className="acl-muted">
                {llmKey.last_test_status ? `last test: ${llmKey.last_test_status}` : 'never tested'}
              </span>
            </p>
            {llmKey.last_test_error && (
              <p className="acl-hint acl-hint--warn">{llmKey.last_test_error}</p>
            )}
            <p className="acl-hint">
              Drives QMS AI&rsquo;s RAG and chat — a different key, and usually a different model,
              from the traceability engine above. It is still edited in the QMS AI app&rsquo;s own
              admin panel; this console shows its state so the two are visible together.
            </p>
          </>
        ) : (
          <p className="acl-hint">
            No key of its own — this account falls back to the QMS AI server&rsquo;s shared key.
          </p>
        )}
      </section>
    </div>
  );
}
