'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AuditLogRow } from '@/lib/types';

/**
 * The security-event trail. Shared with the QMS backend — both apps append to
 * `security_audit_log` — so this is the platform's whole trail, not just this
 * app's. ISO 27001:2022 A.8.15 / A.8.16 evidence.
 *
 * There was no UI for this before; the QMS exposed `GET /admin/audit-log` and
 * nothing called it. Account changes are exactly the kind of event an auditor
 * asks to see, so the console shows it.
 */
export default function AuditClient() {
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [eventType, setEventType] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = eventType ? `?event_type=${encodeURIComponent(eventType)}` : '';
      const res = await fetch(`/api/audit-log${qs}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { logs: AuditLogRow[] };
      setLogs(data.logs ?? []);
    } catch (e) {
      setError(`Could not load the audit log: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  }, [eventType]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div className="app-page-header">
        <div>
          <h1>Audit log</h1>
          <p className="app-page-sub">
            Security events across the platform — logins, account changes, key access.
          </p>
        </div>
      </div>

      <div className="app-card">
        <div className="acl-toolbar">
          <input
            className="acl-search"
            placeholder="Filter by event type, e.g. account_created"
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
          />
          <button className="acl-btn-cancel" onClick={() => void load()} disabled={loading}>
            {loading ? 'Loading…' : '↺ Refresh'}
          </button>
        </div>

        {error ? (
          <div style={{ padding: 20 }}>
            <div className="acl-error" style={{ marginBottom: 0 }}>
              {error}
            </div>
          </div>
        ) : loading ? (
          <p className="acl-empty">Loading…</p>
        ) : logs.length === 0 ? (
          <p className="acl-empty">No events.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="acl-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Event</th>
                  <th>Account</th>
                  <th>Actor</th>
                  <th>OK</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="acl-muted" style={{ whiteSpace: 'nowrap' }}>
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td>
                      <span className="acl-badge">{log.event_type}</span>
                    </td>
                    <td>{log.account_name || '—'}</td>
                    <td className="acl-muted">{log.actor_email || '—'}</td>
                    <td>{log.success ? '✓' : '✗'}</td>
                    <td
                      className="acl-muted"
                      style={{
                        maxWidth: 340,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={JSON.stringify(log.detail)}
                    >
                      {Object.keys(log.detail ?? {}).length ? JSON.stringify(log.detail) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
