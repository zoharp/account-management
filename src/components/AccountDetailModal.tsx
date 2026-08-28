'use client';

import { useCallback, useEffect, useState } from 'react';
import TestResult from './TestResult';
import { normalizeOrcanosUrl } from '@/lib/orcanos-url';
import type { AccountRow, ConnectionTestResult, LlmKeyStatus } from '@/lib/types';

/**
 * Port of AccountDetail.jsx — three sections (account info, Orcanos DB +
 * API credentials, vector DB) plus the connection tests.
 *
 * Two rules from the original that must survive any refactor:
 *  1. A password field left blank means "keep the stored secret". Only a
 *     non-empty value is ever sent, and the API only encrypts non-empty values.
 *  2. A NEW vector key cannot be saved until it has tested green. Getting this
 *     wrong bricks a tenant: the key is write-only from the UI's point of view,
 *     so a bad one is undetectable until the next query fails.
 */
export default function AccountDetailModal({
  accountId,
  onSaved,
  onClose,
}: {
  accountId: string;
  onSaved: (updated: Partial<AccountRow>) => void;
  onClose: () => void;
}) {
  const [account, setAccount] = useState<AccountRow | null>(null);
  const [llmKey, setLlmKey] = useState<LlmKeyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Orcanos SQL Server
  const [orcanosHost, setOrcanosHost] = useState('');
  const [orcanosDb, setOrcanosDb] = useState('');
  const [orcanosUser, setOrcanosUser] = useState('');
  const [orcanosPassword, setOrcanosPassword] = useState('');
  const [orcanosApiUrl, setOrcanosApiUrl] = useState('');
  const [testingOrcanos, setTestingOrcanos] = useState(false);
  const [orcanosResult, setOrcanosResult] = useState<ConnectionTestResult | null>(null);

  // Orcanos REST API credentials
  const [apiUsername, setApiUsername] = useState('');
  const [apiPassword, setApiPassword] = useState('');
  const [showApiPw, setShowApiPw] = useState(false);
  const [testingApi, setTestingApi] = useState(false);
  const [apiResult, setApiResult] = useState<ConnectionTestResult | null>(null);

  // Vector DB
  const [vectorType, setVectorType] = useState('supabase');
  const [vectorHost, setVectorHost] = useState('');
  const [vectorDb, setVectorDb] = useState('');
  const [vectorUser, setVectorUser] = useState('');
  const [vectorPassword, setVectorPassword] = useState('');
  const [vectorConnStr, setVectorConnStr] = useState('');
  const [testingVector, setTestingVector] = useState(false);
  const [vectorResult, setVectorResult] = useState<ConnectionTestResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await fetch(`/api/accounts/${accountId}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Could not load account (HTTP ${res.status})`);
      const data = (await res.json()) as { account: AccountRow; llm_key: LlmKeyStatus | null };
      const a = data.account;
      setAccount(a);
      setLlmKey(data.llm_key);
      setIsActive(a.is_active ?? true);
      setOrcanosHost(a.orcanos_db_host ?? '');
      setOrcanosDb(a.orcanos_db_name ?? '');
      setOrcanosUser(a.orcanos_db_user ?? '');
      setOrcanosApiUrl(a.orcanos_api_url ?? '');
      setApiUsername(a.orcanos_username ?? '');
      setVectorType(a.vector_db_type ?? 'supabase');
      setVectorHost(a.vector_db_host ?? '');
      setVectorDb(a.vector_db_name ?? '');
      setVectorUser(a.vector_db_user ?? '');
      setVectorConnStr(a.vector_connection_string ?? '');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Editing any vector field invalidates the test result on screen — otherwise
  // a green tick from the previous value would authorise saving a new one.
  useEffect(() => {
    setVectorResult(null);
  }, [vectorType, vectorHost, vectorUser, vectorDb, vectorPassword, vectorConnStr]);

  async function save() {
    if (vectorPassword && !vectorResult?.success) {
      setSaveError('Test the Vector DB connection successfully before saving the new key.');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const body: Record<string, unknown> = {
        is_active: isActive,
        orcanos_db_type: 'sqlserver',
        orcanos_db_host: orcanosHost,
        orcanos_db_name: orcanosDb,
        orcanos_db_user: orcanosUser,
        orcanos_api_url: orcanosApiUrl || null,
        orcanos_username: apiUsername,
        vector_db_type: vectorType,
        vector_db_host: vectorHost,
        vector_db_name: vectorType === 'supabase' ? 'postgres' : vectorDb,
        vector_db_user: vectorType === 'supabase' ? 'postgres' : vectorUser,
      };
      if (orcanosPassword) body.orcanos_db_password = orcanosPassword;
      if (apiPassword) body.orcanos_api_password = apiPassword;
      if (vectorPassword) body.vector_db_password = vectorPassword;

      const res = await fetch(`/api/accounts/${accountId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
        detail?: string;
      };
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      onSaved({ id: accountId, ...(data as Partial<AccountRow>) });
    } catch (e) {
      setSaveError(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    setSaving(false);
  }

  async function testSavedConnections() {
    setTestingOrcanos(true);
    setOrcanosResult(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}/test-connections`, { method: 'POST' });
      const data = (await res.json()) as {
        orcanos: ConnectionTestResult;
        vector: ConnectionTestResult;
      };
      setOrcanosResult(data.orcanos);
      // Only trust the saved-key vector result while the field is untouched.
      if (!vectorPassword) setVectorResult(data.vector);
    } catch (e) {
      setOrcanosResult({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
    setTestingOrcanos(false);
  }

  async function testVector() {
    setTestingVector(true);
    setVectorResult(null);
    try {
      if (vectorPassword) {
        // Test what is typed, not what is stored.
        const res = await fetch('/api/accounts/test-connection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            db_type: vectorType,
            db_host: vectorHost.trim(),
            db_password: vectorPassword,
            db_user: vectorType === 'supabase' ? 'postgres' : vectorUser.trim(),
            db_name: vectorType === 'supabase' ? 'postgres' : vectorDb || 'postgres',
            connection_string: vectorConnStr.trim(),
          }),
        });
        setVectorResult((await res.json()) as ConnectionTestResult);
      } else {
        const res = await fetch(`/api/accounts/${accountId}/test-connections`, { method: 'POST' });
        const data = (await res.json()) as { vector: ConnectionTestResult };
        setVectorResult(data.vector);
      }
    } catch (e) {
      setVectorResult({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
    setTestingVector(false);
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
          account_id: accountId,
        }),
      });
      setApiResult((await res.json()) as ConnectionTestResult);
    } catch (e) {
      setApiResult({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
    setTestingApi(false);
  }

  return (
    <div className="acl-overlay" onClick={onClose}>
      <div className="acl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="acl-header">
          <h2>{loading ? 'Loading…' : account?.account_name}</h2>
          <button className="acl-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {loading ? (
          <div style={{ padding: 32, textAlign: 'center' }}>Loading…</div>
        ) : loadError ? (
          <div style={{ padding: 24 }}>
            <div className="acl-error">{loadError}</div>
          </div>
        ) : (
          <div className="acl-detail-body">
            <div className="acl-section">
              <div className="acl-field-row">
                <label className="acl-label">Account Name</label>
                <input className="acl-input" value={account?.account_name ?? ''} disabled />
              </div>
              <div className="acl-field-row">
                <label className="acl-label">Status</label>
                <label className="acl-switch">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                  />
                  <span className="acl-switch-label">{isActive ? 'Active' : 'Inactive'}</span>
                </label>
              </div>
              {llmKey && (
                <div className="acl-field-row">
                  <label className="acl-label">LLM Key</label>
                  <div style={{ paddingTop: 8, fontSize: 13 }}>
                    <span className="acl-badge">{llmKey.engine}</span>{' '}
                    <span className="acl-muted">
                      {llmKey.last_test_status
                        ? `last test: ${llmKey.last_test_status}`
                        : 'never tested'}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="acl-section">
              <h3 className="acl-section-title">Orcanos DB (SQL Server — read-only)</h3>
              <div className="acl-field-row">
                <label className="acl-label">Host</label>
                <input
                  className="acl-input"
                  value={orcanosHost}
                  onChange={(e) => setOrcanosHost(e.target.value)}
                  placeholder="server.database.windows.net"
                />
              </div>
              <div className="acl-field-row">
                <label className="acl-label">Database</label>
                <input
                  className="acl-input"
                  value={orcanosDb}
                  onChange={(e) => setOrcanosDb(e.target.value)}
                  placeholder="OrcanosQMS"
                />
              </div>
              <div className="acl-field-row">
                <label className="acl-label">User</label>
                <input
                  className="acl-input"
                  value={orcanosUser}
                  onChange={(e) => setOrcanosUser(e.target.value)}
                  placeholder="sa"
                />
              </div>
              <div className="acl-field-row">
                <label className="acl-label">Password</label>
                <input
                  className="acl-input"
                  type="password"
                  value={orcanosPassword}
                  onChange={(e) => setOrcanosPassword(e.target.value)}
                  placeholder="Leave blank to keep current"
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
                />
              </div>
              <TestResult result={orcanosResult} />

              <div className="acl-subgroup">
                <div className="acl-subgroup-title">
                  API Credentials
                  {apiUsername && !apiPassword && <span className="acl-saved-pill">● saved</span>}
                </div>
                <div className="acl-field-row">
                  <label className="acl-label">Username</label>
                  <input
                    className="acl-input"
                    value={apiUsername}
                    onChange={(e) => setApiUsername(e.target.value)}
                    placeholder="your.name@company.com"
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
                      placeholder="Leave blank to keep saved"
                    />
                    <button
                      type="button"
                      className="acl-pw-toggle"
                      onClick={() => setShowApiPw((v) => !v)}
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
                    disabled={testingApi || !apiUsername}
                  >
                    {testingApi ? 'Testing…' : 'Test API'}
                  </button>
                  <TestResult result={apiResult} />
                </div>
              </div>
            </div>

            <div className="acl-section">
              <h3 className="acl-section-title">Vector DB (AI data)</h3>
              <div className="acl-field-row">
                <label className="acl-label">Type</label>
                <select
                  className="acl-input"
                  value={vectorType}
                  onChange={(e) => setVectorType(e.target.value)}
                >
                  <option value="supabase">Supabase</option>
                  <option value="postgres">PostgreSQL</option>
                </select>
              </div>
              <div className="acl-field-row">
                <label className="acl-label">
                  {vectorType === 'supabase' ? 'Supabase URL' : 'Host'}
                </label>
                <input
                  className="acl-input"
                  value={vectorHost}
                  onChange={(e) => setVectorHost(e.target.value)}
                  placeholder={
                    vectorType === 'supabase' ? 'https://xxx.supabase.co' : 'db.example.com'
                  }
                />
              </div>
              <div className="acl-field-row">
                <label className="acl-label">Database</label>
                <input
                  className="acl-input"
                  value={vectorType === 'supabase' ? 'postgres' : vectorDb}
                  onChange={(e) => setVectorDb(e.target.value)}
                  disabled={vectorType === 'supabase'}
                />
              </div>
              <div className="acl-field-row">
                <label className="acl-label">User</label>
                <input
                  className="acl-input"
                  value={vectorType === 'supabase' ? 'postgres' : vectorUser}
                  onChange={(e) => setVectorUser(e.target.value)}
                  disabled={vectorType === 'supabase'}
                  placeholder="postgres"
                />
              </div>
              <div className="acl-field-row">
                <label className="acl-label">
                  {vectorType === 'supabase' ? 'Service Key' : 'Password'}
                </label>
                <input
                  className="acl-input"
                  type="password"
                  value={vectorPassword}
                  onChange={(e) => setVectorPassword(e.target.value)}
                  placeholder="Leave blank to keep current"
                />
              </div>
              <div className="acl-inline-actions">
                <button
                  type="button"
                  className="acl-btn-cancel"
                  onClick={() => void testVector()}
                  disabled={testingVector || !vectorHost.trim()}
                >
                  {testingVector ? 'Testing…' : 'Test Connection'}
                </button>
                <TestResult result={vectorResult} />
              </div>
            </div>

            {saveError && <div className="acl-error">{saveError}</div>}

            <div className="acl-actions">
              <button
                className="acl-btn-cancel"
                onClick={() => void testSavedConnections()}
                disabled={testingOrcanos}
              >
                {testingOrcanos ? 'Testing…' : 'Test Orcanos DB'}
              </button>
              <button className="acl-btn-cancel" onClick={onClose}>
                Cancel
              </button>
              <button className="btn-primary" onClick={() => void save()} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
