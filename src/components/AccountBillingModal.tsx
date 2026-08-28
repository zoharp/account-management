'use client';

import { useCallback, useEffect, useState } from 'react';
import type { UsageLogRow } from '@/lib/types';

/**
 * Port of AccountBillingDetail.jsx — the drill-down behind the Total Cost cell.
 *
 * The note about the totals is new and worth keeping: these figures cover the
 * rows on screen, not the account's lifetime. The lifetime number is the one in
 * the list column, which comes from the `account_cost_totals()` RPC. Without
 * saying so, two different numbers labelled "Total Cost" look like a bug.
 */
export default function AccountBillingModal({
  accountId,
  accountName,
  onClose,
}: {
  accountId: string;
  accountName: string;
  onClose: () => void;
}) {
  const [logs, setLogs] = useState<UsageLogRow[]>([]);
  const [totalTokens, setTotalTokens] = useState(0);
  const [totalCost, setTotalCost] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
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
      setErrorMsg(`Error loading billing details: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="acl-overlay" onClick={onClose}>
      <div className="acl-modal acl-modal--billing" onClick={(e) => e.stopPropagation()}>
        <div className="acl-header">
          <h2>Billing — {accountName}</h2>
          <button className="acl-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="acl-detail-body">
          {errorMsg && <div className="acl-error">{errorMsg}</div>}

          <div className="analytics-totals">
            <div className="analytics-total-card">
              <div className="analytics-total-label">Tokens (shown)</div>
              <div className="analytics-total-value">{totalTokens.toLocaleString()}</div>
            </div>
            <div className="analytics-total-card highlight">
              <div className="analytics-total-label">Cost (shown)</div>
              <div className="analytics-total-value">${totalCost.toFixed(4)}</div>
            </div>
            <button className="acl-btn-cancel" onClick={() => void load()} disabled={loading}>
              {loading ? 'Loading…' : '↺ Refresh'}
            </button>
          </div>

          <p className="acl-hint" style={{ marginBottom: 14 }}>
            Totals cover the {logs.length} most recent events listed below. The lifetime figure for
            this account is the one in the Total Cost column of the accounts list.
          </p>

          {loading ? (
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
        </div>
      </div>
    </div>
  );
}
