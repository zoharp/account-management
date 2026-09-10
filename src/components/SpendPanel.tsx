'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TraceRow, TraceSettingsResponse, TraceUsageRow } from '@/lib/trace-ui';
import type { UsageLogRow } from '@/lib/types';

/**
 * The Spend tab — both of this customer's AI ledgers, in one place.
 *
 * ## Why both
 *
 * The platform bills this customer for AI twice, from two systems that never
 * meet: **Ask Paul** (QMS AI) writes `account_usage_logs` in the master
 * database, and **traceability** keeps its own counter on the tenant's allowlist
 * row. Neither knows about the other, so neither number is "the" spend — and
 * the traceability half used to be at the bottom of the Traceability settings
 * dialog, which is not where anyone looks for a cost. Answering "what does this
 * customer cost us" meant knowing that, and remembering to add up.
 *
 * The two stay clearly separate, with their own units and their own caveats.
 * Adding them into one headline figure would be inventing a number: they are
 * different currencies of attention — one is a lifetime total from a counter,
 * the other a sum over the events actually fetched.
 */
export default function SpendPanel({
  accountId,
  tenant,
}: {
  accountId: string | null;
  tenant: string | null;
}) {
  // ── Ask Paul (master account_usage_logs) ────────────────────────────────
  const [logs, setLogs] = useState<UsageLogRow[]>([]);
  const [totalTokens, setTotalTokens] = useState(0);
  const [totalCost, setTotalCost] = useState(0);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logsError, setLogsError] = useState('');

  // ── Traceability (trace row counter + its own usage table) ──────────────
  const [row, setRow] = useState<TraceRow | null>(null);
  const [traceError, setTraceError] = useState('');
  const [usage, setUsage] = useState<TraceUsageRow[]>([]);
  const [usageTotals, setUsageTotals] = useState<{ cost: number; calls: number } | null>(null);
  const [usageOpen, setUsageOpen] = useState(false);

  const loadLogs = useCallback(async () => {
    if (!accountId) return;
    setLoadingLogs(true);
    setLogsError('');
    try {
      const res = await fetch(`/api/accounts/${accountId}/usage-logs`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        logs: UsageLogRow[];
        total_tokens: number;
        total_cost_usd: number;
      };
      setLogs(data.logs ?? []);
      setTotalTokens(data.total_tokens ?? 0);
      setTotalCost(data.total_cost_usd ?? 0);
    } catch (e) {
      setLogsError(`Error loading Ask Paul usage: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoadingLogs(false);
  }, [accountId]);

  const loadTrace = useCallback(async () => {
    if (!tenant) return;
    setTraceError('');
    try {
      const res = await fetch(`/api/accounts/trace/${encodeURIComponent(tenant)}`, {
        cache: 'no-store',
      });
      const data = (await res.json()) as TraceSettingsResponse;
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setRow(data.row);
    } catch (e) {
      setTraceError(e instanceof Error ? e.message : String(e));
    }
  }, [tenant]);

  useEffect(() => {
    void loadLogs();
    void loadTrace();
  }, [loadLogs, loadTrace]);

  async function loadUsage() {
    if (!tenant) return;
    setUsageOpen(true);
    try {
      const res = await fetch(`/api/accounts/trace/${encodeURIComponent(tenant)}/usage?limit=200`, {
        cache: 'no-store',
      });
      const data = (await res.json()) as {
        rows?: TraceUsageRow[];
        total_cost_usd?: number;
        total_calls?: number;
        detail?: string;
      };
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setUsage(data.rows ?? []);
      setUsageTotals({ cost: data.total_cost_usd ?? 0, calls: data.total_calls ?? 0 });
    } catch (e) {
      setTraceError(e instanceof Error ? e.message : String(e));
      setUsageOpen(false);
    }
  }

  return (
    <div className="acl-detail-body">
      <p className="acl-hint">
        Two separate ledgers, kept by two systems that do not know about each other. They are shown
        apart rather than summed — one is a lifetime counter, the other a total over the events
        listed, so a combined figure would mean nothing.
      </p>

      {/* ── Traceability ──────────────────────────────────────────────────── */}
      <section className="acl-section">
        <h3 className="acl-section-title">Traceability AI</h3>
        {!tenant ? (
          <p className="acl-hint">This account has no Orcanos tenant, so it has no traceability spend.</p>
        ) : traceError ? (
          <div className="acl-error">{traceError}</div>
        ) : (
          <>
            <p className="acl-hint">
              <strong>${Number(row?.ai_cost_usd ?? 0).toFixed(4)}</strong> over {row?.ai_calls ?? 0}{' '}
              call{row?.ai_calls === 1 ? '' : 's'} — lifetime, from the tenant&rsquo;s own counter.
              Panel-describe, trace-build and duplicate scoring.
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
          </>
        )}
      </section>

      {/* ── Ask Paul ──────────────────────────────────────────────────────── */}
      <section className="acl-section">
        <h3 className="acl-section-title">Ask Paul (QMS AI)</h3>
        {!accountId ? (
          <p className="acl-hint">
            This tenant has no master account record, so it has no Ask Paul usage log.
          </p>
        ) : (
          <>
            {logsError && <div className="acl-error">{logsError}</div>}

            <div className="analytics-totals">
              <div className="analytics-total-card">
                <div className="analytics-total-label">Tokens (shown)</div>
                <div className="analytics-total-value">{totalTokens.toLocaleString()}</div>
              </div>
              <div className="analytics-total-card highlight">
                <div className="analytics-total-label">Cost (shown)</div>
                <div className="analytics-total-value">${totalCost.toFixed(4)}</div>
              </div>
              <button className="acl-btn-cancel" onClick={() => void loadLogs()} disabled={loadingLogs}>
                {loadingLogs ? 'Loading…' : '↺ Refresh'}
              </button>
            </div>

            <p className="acl-hint" style={{ marginBottom: 14 }}>
              Totals cover the {logs.length} most recent events listed below — not the
              account&rsquo;s lifetime. The lifetime figure is the one in the Total Cost column of
              the accounts list, which comes from a different query; two numbers labelled &ldquo;total
              cost&rdquo; that disagree are these two.
            </p>

            {loadingLogs ? (
              <p className="acl-empty">Loading…</p>
            ) : logs.length === 0 ? (
              <p className="acl-empty">No usage logs yet.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="acl-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Repository</th>
                      <th>Action</th>
                      <th>Conversation</th>
                      <th style={{ textAlign: 'right' }}>Tokens</th>
                      <th style={{ textAlign: 'right' }}>Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id}>
                        <td className="acl-muted" style={{ whiteSpace: 'nowrap' }}>
                          {log.created_at ? new Date(log.created_at).toLocaleString() : '—'}
                        </td>
                        <td>{log.repository_name || '—'}</td>
                        <td>
                          <span className={`action-badge action-${log.action}`}>
                            {log.action === 'conversation' ? '💬 Chat' : '📥 Index'}
                          </span>
                        </td>
                        <td
                          style={{
                            maxWidth: 200,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {log.conversation_name || '—'}
                        </td>
                        <td className="acl-num">{(log.tokens || 0).toLocaleString()}</td>
                        <td className="acl-num">${Number(log.cost_usd || 0).toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
