'use client';

import { useCallback, useEffect, useState } from 'react';
import { AUDIT_EVENT_GROUPS, groupOf } from '@/lib/audit-events';
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
  /** Group keys, not event types — several groups can be on at once. */
  const [groups, setGroups] = useState<string[]>([]);
  const [account, setAccount] = useState('');

  // Groups expand to their event types; the route takes a comma-separated list
  // and turns it into one `in.(…)`, so "Sign-in + Secrets" is a single query
  // rather than two round trips merged in the browser.
  const selectedTypes = AUDIT_EVENT_GROUPS.filter((g) => groups.includes(g.key)).flatMap(
    (g) => g.types,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams();
      if (selectedTypes.length) qs.set('event_type', selectedTypes.join(','));
      if (account.trim()) qs.set('account_name', account.trim());
      const query = qs.toString();
      const res = await fetch(`/api/audit-log${query ? `?${query}` : ''}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { logs: AuditLogRow[] };
      setLogs(data.logs ?? []);
    } catch (e) {
      setError(`Could not load the audit log: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
    // selectedTypes is derived from `groups`, so that is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, account]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleGroup = (key: string) =>
    setGroups((prev) => (prev.includes(key) ? prev.filter((g) => g !== key) : [...prev, key]));

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
            placeholder="Filter by account name…"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          />
          <button className="acl-btn-cancel" onClick={() => void load()} disabled={loading}>
            {loading ? 'Loading…' : '↺ Refresh'}
          </button>
        </div>

        {/* Group chips rather than a free-text event name: nobody remembers
            that revealing an LLM key is `llm_key_revealed`, and the question
            being asked is almost always "show me the secret-related events",
            not one exact type. Several can be on at once. */}
        <div className="acl-filterbar">
          <button
            className={`acl-chip ${groups.length === 0 ? 'acl-chip--on' : ''}`}
            onClick={() => setGroups([])}
            title="Every event, unfiltered"
          >
            All events
          </button>
          {AUDIT_EVENT_GROUPS.map((g) => (
            <button
              key={g.key}
              className={`acl-chip ${groups.includes(g.key) ? 'acl-chip--on' : ''}`}
              onClick={() => toggleGroup(g.key)}
              title={g.hint}
            >
              {g.label}
            </button>
          ))}
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
          <p className="acl-empty">
            {groups.length || account
              ? 'No events match this filter.'
              : 'No events recorded yet. The trail began on 2026-08-29, when the table was created — nothing before that was ever written.'}
          </p>
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
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span className="acl-badge">{log.event_type}</span>
                      {/* An event with no group is one nobody has catalogued —
                          worth showing as such rather than silently blank. */}
                      <span className="acl-muted" style={{ marginLeft: 6 }}>
                        {groupOf(log.event_type)?.label ?? 'uncatalogued'}
                      </span>
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
