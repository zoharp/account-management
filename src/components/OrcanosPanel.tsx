'use client';

import { useCallback, useEffect, useState } from 'react';
import TestResult from './TestResult';
import { normalizeOrcanosUrl, traceTenantForAccount } from '@/lib/orcanos-url';
import { coerceRegion, REGION_LABELS } from '@/lib/regions';
import type { AccountRow, ConnectionTestResult } from '@/lib/types';

/**
 * The Orcanos tab — how this console reaches the customer's own Orcanos QMS.
 *
 * ## Why this is neither the Traceability nor the Ask Paul tab
 *
 * Orcanos is the customer's *existing* product, and both of our apps hang off
 * it: traceability reads its work items and signs users in against it, and Ask
 * Paul's ETL pulls documents through the same REST API to index them. The URL
 * here is also **how the tenant is derived** — there is no `orcanos_tenant`
 * column, so the virtual directory in this URL is what every module licence is
 * keyed on. Filing it under either app would make it look like only that app's
 * business.
 *
 * ## About the SQL Server section
 *
 * Read the note rendered above it. In short: those credentials are stored,
 * encrypted and testable, and **nothing reads them.** That is worth saying on
 * screen rather than leaving an operator to guess what a required-looking
 * database section is for.
 */
export default function OrcanosPanel({
  accountId,
  onSaved,
  onClose,
}: {
  accountId: string;
  onSaved: (patch?: Partial<AccountRow>) => void;
  onClose: () => void;
}) {
  const [account, setAccount] = useState<AccountRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);

  // REST API
  const [apiUrl, setApiUrl] = useState('');
  const [apiUsername, setApiUsername] = useState('');
  const [apiPassword, setApiPassword] = useState('');
  const [showApiPw, setShowApiPw] = useState(false);
  const [testingApi, setTestingApi] = useState(false);
  const [apiResult, setApiResult] = useState<ConnectionTestResult | null>(null);

  // SQL Server
  const [sqlOpen, setSqlOpen] = useState(false);
  const [host, setHost] = useState('');
  const [db, setDb] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [testingSql, setTestingSql] = useState(false);
  const [sqlResult, setSqlResult] = useState<ConnectionTestResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await fetch(`/api/accounts/${accountId}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Could not load account (HTTP ${res.status})`);
      const { account: a } = (await res.json()) as { account: AccountRow };
      setAccount(a);
      setApiUrl(a.orcanos_api_url ?? '');
      setApiUsername(a.orcanos_username ?? '');
      setHost(a.orcanos_db_host ?? '');
      setDb(a.orcanos_db_name ?? '');
      setUser(a.orcanos_db_user ?? '');
      // Opened when there is something in it, so a configured account does not
      // look like an unconfigured one behind a collapsed heading.
      setSqlOpen(Boolean((a.orcanos_db_host ?? '').trim()));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function testApi() {
    setTestingApi(true);
    setApiResult(null);
    try {
      const res = await fetch('/api/orcanos/test-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_url: normalizeOrcanosUrl(apiUrl),
          password: apiPassword || undefined,
          username: apiUsername,
          account_id: accountId,
        }),
      });
      setApiResult((await res.json()) as ConnectionTestResult);
    } catch (e) {
      setApiResult({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
    setTestingApi(false);
  }

  async function testSql() {
    setTestingSql(true);
    setSqlResult(null);
    try {
      // Tests the SAVED credentials — there is no test-what-is-typed path for
      // SQL Server, so save first if the fields have been edited.
      const res = await fetch(`/api/accounts/${accountId}/test-connections`, { method: 'POST' });
      const data = (await res.json()) as { orcanos: ConnectionTestResult };
      setSqlResult(data.orcanos);
    } catch (e) {
      setSqlResult({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
    setTestingSql(false);
  }

  async function save() {
    setSaving(true);
    setSaveError('');
    setSaved(false);
    try {
      const body: Record<string, unknown> = {
        orcanos_api_url: apiUrl || null,
        orcanos_username: apiUsername,
        orcanos_db_type: 'sqlserver',
        orcanos_db_host: host,
        orcanos_db_name: db,
        orcanos_db_user: user,
      };
      // A blank password field means "keep the stored secret" — only non-empty
      // values are sent, and the API only encrypts non-empty values.
      if (apiPassword) body.orcanos_api_password = apiPassword;
      if (password) body.orcanos_db_password = password;

      const res = await fetch(`/api/accounts/${accountId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
        detail?: string;
      };
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setApiPassword('');
      setPassword('');
      setSaved(true);
      onSaved({ id: accountId, ...(data as Partial<AccountRow>) });
    } catch (e) {
      setSaveError(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
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

  const derived = traceTenantForAccount({
    orcanosApiUrl: apiUrl,
    accountName: account?.account_name ?? '',
  });

  return (
    <div className="acl-detail-body">
      <section className="acl-section">
        <div className="acl-field-row">
          <label className="acl-label">Account Name</label>
          <input className="acl-input" value={account?.account_name ?? ''} disabled />
        </div>
        {/*
          Data region — shown, never editable here. Not disabled for the usual
          cosmetic reason: changing this value would move no data, it would only
          record the account as living somewhere it does not, and the API refuses
          it outright. Moving is on the Overview tab.
        */}
        <div className="acl-field-row">
          <label className="acl-label">Data Region</label>
          <input
            className="acl-input"
            value={REGION_LABELS[coerceRegion(account?.region)].label}
            disabled
          />
        </div>
      </section>

      {/* ── REST API ──────────────────────────────────────────────────────── */}
      <section className="acl-section">
        <h3 className="acl-section-title">Orcanos REST API</h3>
        <p className="acl-hint">
          The customer&rsquo;s Orcanos server. This is what users sign in against, what Ask
          Paul&rsquo;s indexer pulls documents through, and — because there is no tenant column in
          the master database — <strong>what identifies the tenant</strong> everywhere else.
        </p>

        <div className="acl-field-row">
          <label className="acl-label">REST API URL</label>
          <input
            className="acl-input"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            onBlur={() => setApiUrl(normalizeOrcanosUrl(apiUrl))}
            placeholder="app.orcanos.com/orcanos"
          />
        </div>

        <p className={`acl-hint ${derived.from === 'url' ? '' : 'acl-hint--warn'}`}>
          {derived.from === 'url' ? (
            <>
              Tenant <code>{derived.tenant}</code>, taken from the last segment of this URL. Module
              licences, the traceability allowlist row and the region directory are all keyed on it —
              <strong> changing this URL points them at a different tenant.</strong>
            </>
          ) : (
            <>
              No URL, so the tenant falls back to the account name (<code>{derived.tenant}</code>) —
              a guess. Traceability and Ask Paul licensing need a real one: set the URL.
            </>
          )}
        </p>

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
      </section>

      {/* ── SQL Server ────────────────────────────────────────────────────── */}
      <section className="acl-section">
        {!sqlOpen ? (
          <button className="acl-disclosure" onClick={() => setSqlOpen(true)}>
            Direct SQL Server connection — not configured, and nothing needs it
          </button>
        ) : (
          <>
            <h3 className="acl-section-title">Orcanos SQL Server (direct, read-only)</h3>
            <p className="acl-hint acl-hint--warn">
              <strong>Nothing currently reads this.</strong> It is a direct ODBC connection to the
              customer&rsquo;s Orcanos database, held for reporting against Orcanos data without
              going through the REST API. Both apps read Orcanos through the API above instead, and
              the only code that touches these credentials anywhere on the platform is the{' '}
              <em>Test</em> button below. They are stored encrypted like any other secret — leaving
              them blank costs nothing, and filling them in enables nothing.
            </p>
            <div className="acl-field-row">
              <label className="acl-label">Host</label>
              <input
                className="acl-input"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="server.database.windows.net"
              />
            </div>
            <div className="acl-field-row">
              <label className="acl-label">Database</label>
              <input
                className="acl-input"
                value={db}
                onChange={(e) => setDb(e.target.value)}
                placeholder="OrcanosQMS"
              />
            </div>
            <div className="acl-field-row">
              <label className="acl-label">User</label>
              <input
                className="acl-input"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                placeholder="sa"
              />
            </div>
            <div className="acl-field-row">
              <label className="acl-label">Password</label>
              <input
                className="acl-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Leave blank to keep current"
              />
            </div>
            <div className="acl-inline-actions">
              <button
                type="button"
                className="acl-btn-cancel"
                onClick={() => void testSql()}
                disabled={testingSql}
              >
                {testingSql ? 'Testing…' : 'Test saved connection'}
              </button>
              <TestResult result={sqlResult} />
            </div>
            <p className="acl-hint">
              The test uses the <strong>saved</strong> credentials, not what is typed above — save
              first if you have just edited them.
            </p>
          </>
        )}
      </section>

      {saveError && <div className="acl-error">{saveError}</div>}
      {saved && !saveError && <p className="acl-hint acl-hint--ok">✓ Saved</p>}

      <div className="acl-actions">
        <button className="acl-btn-cancel" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
