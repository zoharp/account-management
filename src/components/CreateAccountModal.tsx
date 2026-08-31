'use client';

import { useEffect, useRef, useState } from 'react';
import TestResult from './TestResult';
import { normalizeOrcanosUrl } from '@/lib/orcanos-url';
import type { AccountListRow, ConnectionTestResult, ProvisionState } from '@/lib/types';

/**
 * Port of CreateAccountModal.jsx.
 *
 * The form and the progress log are unchanged. What changed is the transport:
 * QMS reads one long NDJSON stream, this polls a resumable job (see
 * lib/provisioning.ts for why). The rendered log lines are identical, so the
 * user-visible behaviour is the same.
 *
 * Closing the modal mid-provision does NOT cancel the job — it keeps running
 * server-side and the account appears on the next refresh. The dialog says so,
 * because in the streaming version closing it really did abandon the work.
 */

const POLL_MS = 4000;

interface LogLine {
  type: 'info' | 'complete' | 'error';
  text: string;
}

interface JobView {
  id: string;
  state: ProvisionState;
  project_status: string | null;
  message: string | null;
}

export default function CreateAccountModal({
  onCreated,
  onClose,
}: {
  onCreated: (account: AccountListRow) => void;
  onClose: () => void;
}) {
  const [accountName, setAccountName] = useState('');

  const [orcanosHost, setOrcanosHost] = useState('');
  const [orcanosDb, setOrcanosDb] = useState('');
  const [orcanosUser, setOrcanosUser] = useState('');
  const [orcanosPassword, setOrcanosPassword] = useState('');
  const [orcanosApiUrl, setOrcanosApiUrl] = useState('');
  const [apiUsername, setApiUsername] = useState('');
  const [apiPassword, setApiPassword] = useState('');
  const [showApiPw, setShowApiPw] = useState(false);
  const [testingApi, setTestingApi] = useState(false);
  const [apiResult, setApiResult] = useState<ConnectionTestResult | null>(null);

  // Which modules the new tenant is licensed for. These are written to the
  // traceability instance's `account_access` row, which is where all three
  // licences live — see lib/module-catalog.ts.
  const [modTrace, setModTrace] = useState(true);
  const [modTraining, setModTraining] = useState(false);
  const [modAskPaul, setModAskPaul] = useState(false);

  // Off by default. Only Ask Paul needs a per-tenant database, and provisioning
  // one is the slowest and most failure-prone step in this form; an account
  // that is only licensed for Traceability or Training needs nothing from it.
  const [provisionDb, setProvisionDb] = useState(false);

  const [creating, setCreating] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [lines, setLines] = useState<LogLine[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const lastKeyRef = useRef<string>('');

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  function addLine(type: LogLine['type'], text: string) {
    setLines((prev) => [...prev, { type, text }]);
  }

  /**
   * Turn a polled job state into log lines, suppressing repeats — the poll
   * fires every few seconds but the state only changes every minute or so.
   */
  function renderJob(job: JobView) {
    const key = `${job.state}:${job.project_status ?? ''}`;
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;

    switch (job.state) {
      case 'creating_project':
        addLine('info', job.message || 'Creating Supabase project…');
        break;
      case 'waiting_healthy':
        addLine(
          'info',
          `Waiting for database to come online (${job.project_status || 'starting'})`,
        );
        break;
      case 'fetching_keys':
        addLine('info', 'Fetching API keys');
        break;
      case 'running_schema':
        addLine('info', 'Setting up schema');
        break;
      case 'saving_account':
        addLine('complete', 'Database ready');
        break;
      case 'done':
        addLine('complete', 'Account created');
        break;
      case 'error':
        addLine('error', job.message || 'Failed');
        break;
    }
  }

  async function testApi() {
    setTestingApi(true);
    setApiResult(null);
    try {
      const res = await fetch('/api/orcanos/test-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_url: normalizeOrcanosUrl(orcanosApiUrl),
          username: apiUsername,
          password: apiPassword || undefined,
        }),
      });
      setApiResult((await res.json()) as ConnectionTestResult);
    } catch (e) {
      setApiResult({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
    setTestingApi(false);
  }

  async function create() {
    if (!accountName.trim()) {
      setError('Account name is required.');
      return;
    }
    setCreating(true);
    setError('');
    setLines([]);
    setDone(false);
    lastKeyRef.current = '';

    try {
      const body: Record<string, string> = {
        account_name: accountName.trim(),
        orcanos_db_host: orcanosHost.trim(),
        orcanos_db_name: orcanosDb.trim(),
        orcanos_db_user: orcanosUser.trim(),
        orcanos_api_url: orcanosApiUrl.trim(),
        orcanos_username: apiUsername.trim(),
      };
      if (orcanosPassword) body.orcanos_db_password = orcanosPassword;
      if (apiPassword) body.orcanos_api_password = apiPassword;

      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...body,
          provision: provisionDb,
          modules: { trace: modTrace, training: modTraining, ask_paul: modAskPaul },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        job?: JobView;
        account?: AccountListRow;
        detail?: string;
      };

      // No database asked for: the account already exists when this returns,
      // there is no job to drive. A 502 means master was written but the module
      // licences were not — `detail` names which half landed, and the account
      // must still be added to the list.
      if (!provisionDb) {
        if (data.account) onCreated(data.account);
        if (!res.ok) {
          setError(data.detail || `Server error (${res.status})`);
          setCreating(false);
          return;
        }
        setLines([{ type: 'complete', text: `Account '${accountName.trim()}' created` }]);
        setDone(true);
        setCreating(false);
        return;
      }

      if (!res.ok || !data.job) {
        setError(data.detail || `Server error (${res.status})`);
        setCreating(false);
        return;
      }

      setJobId(data.job.id);
      renderJob(data.job);
      if (data.job.state === 'error') {
        setError(data.job.message || 'Account creation failed');
        setCreating(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create account');
      setCreating(false);
    }
  }

  // Drive the job forward. Each POST advances it by one step and returns the
  // new state; a failed poll is retried on the next interval rather than
  // failing the job, since the work continues server-side regardless.
  useEffect(() => {
    if (!jobId || !creating) return;

    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/accounts/provision/${jobId}`, { method: 'POST' });
        if (!res.ok) return;
        const data = (await res.json()) as { job: JobView; account: AccountListRow | null };
        if (cancelled) return;

        renderJob(data.job);

        if (data.job.state === 'done') {
          setDone(true);
          setCreating(false);
          if (data.account) onCreated(data.account);
        } else if (data.job.state === 'error') {
          setError(data.job.message || 'Account creation failed');
          setCreating(false);
        }
      } catch {
        // Transient — the next tick retries.
      }
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [jobId, creating, onCreated]);

  const linePrefix: Record<LogLine['type'], string> = {
    info: '  ',
    complete: '  ✓',
    error: '  ✗',
  };

  return (
    <div className="acl-overlay" onClick={creating ? undefined : onClose}>
      <div className="acl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="acl-header">
          <h2>Create New Account</h2>
          <button className="acl-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="acl-detail-body">
          <div className="acl-section">
            <div className="acl-field-row">
              <label className="acl-label">Account Name *</label>
              <input
                className="acl-input"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="e.g. medtech-corp"
                disabled={creating || done}
              />
            </div>
          </div>

          <div className="acl-section">
            <h3 className="acl-section-title">Modules</h3>
            <label className="acl-check">
              <input
                type="checkbox"
                checked={modTrace}
                onChange={(e) => setModTrace(e.target.checked)}
                disabled={creating || done}
              />
              <span>
                <strong>Traceability</strong> — requirement-to-test matrices, coverage funnel,
                trace graph.
              </span>
            </label>
            <label className="acl-check">
              <input
                type="checkbox"
                checked={modTraining}
                onChange={(e) => setModTraining(e.target.checked)}
                disabled={creating || done}
              />
              <span>
                <strong>Training</strong> — who owes training on which document revision.
              </span>
            </label>
            <label className="acl-check">
              <input
                type="checkbox"
                checked={modAskPaul}
                onChange={(e) => setModAskPaul(e.target.checked)}
                disabled={creating || done}
              />
              <span>
                <strong>Ask Paul</strong> — the RAG compliance assistant.{' '}
                <em>Needs a database.</em>
              </span>
            </label>
            <p className="acl-hint">
              Licences are stored on the traceability instance. Traceability and Training need
              nothing else — they are usable as soon as the account exists.
            </p>
          </div>

          <div className="acl-section">
            <h3 className="acl-section-title">
              Database <span>only Ask Paul needs one</span>
            </h3>
            <label className="acl-check">
              <input
                type="checkbox"
                checked={provisionDb}
                onChange={(e) => setProvisionDb(e.target.checked)}
                disabled={creating || done}
              />
              <span>
                Provision a dedicated Supabase database now — takes 1–2 minutes.
              </span>
            </label>
            {modAskPaul && !provisionDb && (
              <p className="acl-hint">
                Ask Paul is licensed but has no database, so it will not work yet. Add one later
                from the account&rsquo;s detail screen, or tick the box above.
              </p>
            )}
            {provisionDb && (
              <p className="acl-hint">
                ⚠️ Provisioning creates a <strong>real, billable</strong> Supabase project before
                the account row exists. If a later step fails the project is left behind and has to
                be removed by hand.
              </p>
            )}
          </div>

          <div className="acl-section">
            <h3 className="acl-section-title">
              Orcanos DB — SQL Server <span>optional</span>
            </h3>
            <div className="acl-field-row">
              <label className="acl-label">Host</label>
              <input
                className="acl-input"
                value={orcanosHost}
                onChange={(e) => setOrcanosHost(e.target.value)}
                placeholder="server.database.windows.net"
                disabled={creating}
              />
            </div>
            <div className="acl-field-row">
              <label className="acl-label">Database</label>
              <input
                className="acl-input"
                value={orcanosDb}
                onChange={(e) => setOrcanosDb(e.target.value)}
                placeholder="OrcanosQMS"
                disabled={creating}
              />
            </div>
            <div className="acl-field-row">
              <label className="acl-label">User</label>
              <input
                className="acl-input"
                value={orcanosUser}
                onChange={(e) => setOrcanosUser(e.target.value)}
                placeholder="sa"
                disabled={creating}
              />
            </div>
            <div className="acl-field-row">
              <label className="acl-label">Password</label>
              <input
                className="acl-input"
                type="password"
                value={orcanosPassword}
                onChange={(e) => setOrcanosPassword(e.target.value)}
                placeholder="Optional"
                disabled={creating}
              />
            </div>
            <div className="acl-field-row">
              <label className="acl-label">REST API URL</label>
              <input
                className="acl-input"
                value={orcanosApiUrl}
                onChange={(e) => setOrcanosApiUrl(e.target.value)}
                onBlur={() => setOrcanosApiUrl(normalizeOrcanosUrl(orcanosApiUrl))}
                placeholder="app.orcanos.com/orcanos"
                disabled={creating}
              />
            </div>

            <div className="acl-subgroup">
              <div className="acl-subgroup-title">API Credentials</div>
              <div className="acl-field-row">
                <label className="acl-label">Username</label>
                <input
                  className="acl-input"
                  value={apiUsername}
                  onChange={(e) => setApiUsername(e.target.value)}
                  placeholder="your.name@company.com"
                  disabled={creating}
                />
              </div>
              <div className="acl-field-row">
                <label className="acl-label">Password</label>
                <div className="acl-pw-wrap">
                  <input
                    className="acl-input"
                    type={showApiPw ? 'text' : 'password'}
                    value={apiPassword}
                    onChange={(e) => setApiPassword(e.target.value)}
                    placeholder="Optional"
                    disabled={creating}
                  />
                  <button
                    type="button"
                    className="acl-pw-toggle"
                    onClick={() => setShowApiPw((v) => !v)}
                    disabled={creating}
                    aria-label={showApiPw ? 'Hide password' : 'Show password'}
                  >
                    {showApiPw ? '🙈' : '👁'}
                  </button>
                </div>
              </div>
              <div className="acl-inline-actions">
                <button
                  type="button"
                  className="acl-btn-cancel"
                  onClick={() => void testApi()}
                  disabled={testingApi || creating || !orcanosApiUrl.trim() || !apiUsername.trim()}
                >
                  {testingApi ? 'Testing…' : 'Test API'}
                </button>
                <TestResult result={apiResult} />
              </div>
            </div>
          </div>

          {(creating || lines.length > 0) && (
            <div className="acl-log">
              {lines.length === 0 && <div className="acl-log-info">Starting…</div>}
              {lines.map((ln, i) => (
                <div key={i} className={`acl-log-${ln.type}`}>
                  {linePrefix[ln.type]} {ln.text}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}

          {creating && (
            <div className="acl-warning" style={{ marginTop: 10 }}>
              Provisioning continues on the server. You can close this dialog — the account will
              appear in the list once it finishes.
            </div>
          )}

          {error && <div className="acl-error">{error}</div>}

          <div className="acl-actions">
            <button className="acl-btn-cancel" onClick={onClose}>
              {creating ? 'Close' : 'Cancel'}
            </button>
            <button
              className="btn-primary"
              onClick={() => void create()}
              disabled={creating || done}
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
