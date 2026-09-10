'use client';

import { useCallback, useEffect, useState } from 'react';
import Check from './Check';
import TestResult from './TestResult';
import { ASK_PAUL_NEEDS_DB_HINT, type TraceRow, type TraceSettingsResponse } from '@/lib/trace-ui';
import type { AccountRow, ConnectionTestResult } from '@/lib/types';

/**
 * The Ask Paul tab — everything about the QMS AI application for this customer,
 * gathered from the two places it was scattered across.
 *
 * ## Why one tab
 *
 * Ask Paul's settings used to be split by *which database happened to store
 * them* rather than by what they are: the **licence** lived in the Traceability
 * dialog (it is a column on the trace allowlist row), while the **database** and
 * the **kill switch** lived in Account & databases (they are columns on the
 * master account). So turning Ask Paul on for a customer meant two tabs, and the
 * precondition linking them — *no database, no Ask Paul* — was explained twice
 * and enforced from four different screens. Here they sit next to each other and
 * the precondition is visible where it applies.
 *
 * The two sections still save separately, to two different APIs, because they
 * are two different databases and a single button would have to report half a
 * success. That is the same shape the AI engine editor already uses.
 *
 * ## Why Delete is on this tab
 *
 * Deleting removes the **master account record** — `accounts`, plus the
 * name-keyed `account_llm_keys` and `auth_methods` rows that have no foreign key
 * to it. That record IS the Ask Paul account: its database, its kill switch, its
 * LLM key. It is not the traceability tenant, which survives a delete and has to
 * be removed from the Traceability tab separately. Putting the button here says
 * which of the two apps it destroys.
 *
 * ## The rules that must survive any edit
 *
 *  1. **A blank password means "keep the stored secret."** Only non-empty values
 *     are sent; the API only encrypts non-empty values.
 *  2. **A new vector key cannot be saved until it has tested green.** The key is
 *     write-only from the UI's point of view, so a bad one is undetectable until
 *     the tenant's next query fails. Editing any vector field clears the cached
 *     result — a green tick from the previous value must not authorise saving a
 *     different one.
 *  3. **Ask Paul cannot be turned ON without a database**, on either control:
 *     the licence and the Status switch are two doors to the same thing. Turning
 *     it OFF is never blocked. Both routes enforce the same transition.
 */
export default function AskPaulPanel({
  accountId,
  accountName,
  tenant,
  onSaved,
  onDeleted,
  onClose,
}: {
  /** null when this tenant has no master account record. */
  accountId: string | null;
  accountName: string;
  /** null when the account has no Orcanos tenant, so no trace row holds the licence. */
  tenant: string | null;
  onSaved: (patch?: Partial<AccountRow>) => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [account, setAccount] = useState<AccountRow | null>(null);
  const [traceRow, setTraceRow] = useState<TraceRow | null>(null);
  const [masterName, setMasterName] = useState<string | null>(null);
  const [traceReachable, setTraceReachable] = useState(false);

  // ── Licence (traceability allowlist row) ────────────────────────────────
  const [allowAskPaul, setAllowAskPaul] = useState(true);
  const [askPaulAccount, setAskPaulAccount] = useState('');
  const [savingLicence, setSavingLicence] = useState(false);
  const [licenceStatus, setLicenceStatus] = useState<{ kind: 'ok' | 'bad' | ''; text: string }>({
    kind: '',
    text: '',
  });

  // ── Database + kill switch (master account row) ─────────────────────────
  const [isActive, setIsActive] = useState(true);
  const [vectorType, setVectorType] = useState('supabase');
  const [vectorHost, setVectorHost] = useState('');
  const [vectorDb, setVectorDb] = useState('');
  const [vectorUser, setVectorUser] = useState('');
  const [vectorPassword, setVectorPassword] = useState('');
  const [vectorConnStr, setVectorConnStr] = useState('');
  const [testingVector, setTestingVector] = useState(false);
  const [vectorResult, setVectorResult] = useState<ConnectionTestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [acct, trace] = await Promise.all([
        accountId
          ? fetch(`/api/accounts/${accountId}`, { cache: 'no-store' }).then(async (r) => {
              if (!r.ok) throw new Error(`Could not load account (HTTP ${r.status})`);
              return (await r.json()) as { account: AccountRow };
            })
          : Promise.resolve(null),
        tenant
          ? fetch(`/api/accounts/trace/${encodeURIComponent(tenant)}`, { cache: 'no-store' })
              .then(async (r) => (r.ok ? ((await r.json()) as TraceSettingsResponse) : null))
              .catch(() => null)
          : Promise.resolve(null),
      ]);

      if (acct) {
        const a = acct.account;
        setAccount(a);
        setIsActive(a.is_active ?? true);
        setVectorType(a.vector_db_type ?? 'supabase');
        setVectorHost(a.vector_db_host ?? '');
        setVectorDb(a.vector_db_name ?? '');
        setVectorUser(a.vector_db_user ?? '');
        setVectorConnStr(a.vector_connection_string ?? '');
      }
      if (trace) {
        setTraceReachable(true);
        setTraceRow(trace.row);
        setMasterName(trace.master_account_name);
        // An absent flag reads as licensed — see `on()`. Written out here because
        // this is the one control where fail-open is the deliberate choice.
        setAllowAskPaul(trace.row?.allow_ask_paul === undefined ? true : Boolean(trace.row.allow_ask_paul));
        setAskPaulAccount(trace.row?.ask_paul_account ?? '');
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, [accountId, tenant]);

  useEffect(() => {
    void load();
  }, [load]);

  // Editing any vector field invalidates the test result on screen.
  useEffect(() => {
    setVectorResult(null);
  }, [vectorType, vectorHost, vectorUser, vectorDb, vectorPassword, vectorConnStr]);

  /**
   * Read from the LIVE field, not the loaded account, so typing the host unlocks
   * the switch in the same save — that is the normal way an account gets its
   * database. With no master record at all there is nowhere for one to be.
   */
  const hasDatabase = Boolean(vectorHost.trim() || (account?.db_host ?? '').trim());
  const activateBlocked = !hasDatabase && !isActive;

  async function saveLicence() {
    if (!tenant) return;
    setSavingLicence(true);
    setLicenceStatus({ kind: '', text: '' });
    try {
      // Only Ask Paul's own fields. The PUT falls back to the stored row for
      // everything omitted, so this cannot disturb the traceability flags the
      // Traceability tab owns.
      const res = await fetch(`/api/accounts/trace/${encodeURIComponent(tenant)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allow_ask_paul: allowAskPaul, ask_paul_account: askPaulAccount }),
      });
      const data = (await res.json().catch(() => ({}))) as { detail?: string };
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setLicenceStatus({ kind: 'ok', text: '✓ Saved' });
      onSaved();
      await load();
    } catch (e) {
      setLicenceStatus({ kind: 'bad', text: `✗ ${e instanceof Error ? e.message : String(e)}` });
    }
    setSavingLicence(false);
  }

  async function testVector() {
    if (!accountId) return;
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

  async function save() {
    if (!accountId) return;
    if (vectorPassword && !vectorResult?.success) {
      setSaveError('Test the Vector DB connection successfully before saving the new key.');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const body: Record<string, unknown> = {
        is_active: isActive,
        vector_db_type: vectorType,
        vector_db_host: vectorHost,
        vector_db_name: vectorType === 'supabase' ? 'postgres' : vectorDb,
        vector_db_user: vectorType === 'supabase' ? 'postgres' : vectorUser,
      };
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
      setVectorPassword('');
      onSaved({ id: accountId, ...(data as Partial<AccountRow>) });
      await load();
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

  return (
    <div className="acl-detail-body">
      <p className="acl-hint">
        Ask Paul is the <strong>QMS AI</strong> application — a separate app with its own database
        and its own sign-in, reached by a hand-off button inside traceability. Everything on this tab
        is about that app; nothing here affects the traceability matrix itself.
      </p>

      {/* ── Licence ─────────────────────────────────────────────────────── */}
      <section className="acl-section">
        <h3 className="acl-section-title">Licence</h3>

        {!tenant ? (
          <p className="acl-hint">
            This account has no Orcanos tenant, so it has no traceability allowlist row — and that
            row is where the Ask Paul licence is stored. Set the Orcanos REST API URL on the{' '}
            <em>Orcanos</em> tab first.
          </p>
        ) : !traceReachable ? (
          <p className="acl-hint acl-hint--warn">
            The traceability instance is not reachable, so the licence cannot be read or changed
            right now. The database settings below are unaffected — they live in the master account.
          </p>
        ) : (
          <>
            {!traceRow && (
              <div className="acl-notice acl-notice--warn">
                <strong>Not in the traceability allowlist.</strong> This tenant has no row, so it has
                no Ask Paul licence to change. Add it from the <em>Traceability</em> tab first —
                a row that can sign in but reaches no module is exactly what the “at least one
                module” rule exists to prevent.
              </div>
            )}
            <Check
              label="Ask Paul"
              hint="The hand-off button into the QMS AI app. Off hides it and 403s the SSO endpoint."
              checked={allowAskPaul}
              onChange={setAllowAskPaul}
              // Disabled only while already off, so an account whose database went
              // away can still be UNlicensed. The PUT enforces the same transition.
              disabled={!hasDatabase && !allowAskPaul}
              disabledReason={ASK_PAUL_NEEDS_DB_HINT}
            />

            {!hasDatabase && (
              <p className="acl-hint acl-hint--warn">
                {accountId
                  ? `“${accountName}” has no vector database, so Ask Paul has nowhere to read from.`
                  : 'No master account is linked to this tenant, so it has no Ask Paul database.'}{' '}
                {allowAskPaul
                  ? 'The licence is stored but the hand-off leads nowhere — fill in the Vector DB section below, or turn it off.'
                  : 'Fill in the Vector DB section below before licensing it.'}
              </p>
            )}

            <p className="acl-hint">
              The licence is one of <strong>three</strong> gates. The other two are invisible from
              this console: the user&rsquo;s own Orcanos <code>O</code> permission letter, and the
              traceability deployment having <code>ASK_PAUL_SSO_SECRET</code> and{' '}
              <code>ASK_PAUL_APP_URL</code> set. Only the deployment gate fails closed — so this can
              read “licensed” while the button is hidden from everyone.
            </p>

            <label className="acl-field-row acl-field-row--stack">
              <span>Account name inside Ask Paul</span>
              <input
                value={askPaulAccount}
                placeholder={`blank — sends the tenant name “${tenant}”`}
                onChange={(e) => setAskPaulAccount(e.target.value)}
              />
            </label>

            {/* QMS AI routes on `account_name` (a label, "Medical Portal"), while
                traceability routes on the Orcanos tenant ("orca60"). The trace app
                cannot see the master DB, so it keeps its own copy here — and a copy
                can be wrong. This console reads both, so it is the only place the
                mismatch is visible at all. */}
            {masterName ? (
              askPaulAccount.trim().toLowerCase() === masterName.toLowerCase() ? (
                <p className="acl-hint acl-hint--ok">✓ Matches the master account name.</p>
              ) : (
                <p className="acl-hint acl-hint--warn">
                  In the master database this tenant is <strong>{masterName}</strong>
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
                No master account is linked to this tenant, so there is no name to check against.
                Leave blank unless Ask Paul knows it by a different name.
              </p>
            )}

            {licenceStatus.text && (
              <p
                className={`acl-hint ${licenceStatus.kind ? `acl-hint--${licenceStatus.kind}` : ''}`}
              >
                {licenceStatus.text}
              </p>
            )}

            <div className="acl-actions">
              <button
                className="btn-primary"
                onClick={() => void saveLicence()}
                disabled={savingLicence}
              >
                {savingLicence ? 'Saving…' : 'Save licence'}
              </button>
            </div>
          </>
        )}
      </section>

      {!accountId ? (
        <section className="acl-section">
          <h3 className="acl-section-title">Database</h3>
          <p className="acl-hint">
            This tenant exists in traceability only — it has no master account record, so it has no
            Ask Paul database, no kill switch and nothing to delete.
          </p>
        </section>
      ) : (
        <>
          {/* ── Kill switch ───────────────────────────────────────────────── */}
          <section className="acl-section">
            <h3 className="acl-section-title">Status</h3>
            <div className="acl-field-row">
              <label className="acl-label">Active</label>
              <label className="acl-switch" title={activateBlocked ? ASK_PAUL_NEEDS_DB_HINT : undefined}>
                <input
                  type="checkbox"
                  checked={isActive}
                  disabled={activateBlocked}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                <span className="acl-switch-label">{isActive ? 'Active' : 'Inactive'}</span>
              </label>
            </div>
            <p className="acl-hint">
              <strong>This is Ask Paul&rsquo;s kill switch and nothing else.</strong> It is read in
              exactly two places, both inside the QMS AI backend; traceability never reads it, so an
              inactive account can still sign in to traceability and use every module it is licensed
              for. It sits on this tab for that reason — it used to sit under a generic
              “Status” label where it read as an account-level gate, which it is not.
            </p>
            {activateBlocked && (
              <p className="acl-hint acl-hint--warn">
                Ask Paul needs a database. Fill in <em>Vector DB</em> below and this unlocks — the
                two can be saved together.
              </p>
            )}
          </section>

          {/* ── Vector DB ─────────────────────────────────────────────────── */}
          <section className="acl-section">
            <h3 className="acl-section-title">Vector DB (Ask Paul&rsquo;s data)</h3>
            <p className="acl-hint">
              The tenant&rsquo;s own Supabase project: indexed documents, chat history and usage
              logs. This is the database Ask Paul reads and the only per-tenant one on the platform —
              which is why it cannot be moved between regions with the rest of the account, and why
              no database means no Ask Paul.
            </p>
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
              <label className="acl-label">{vectorType === 'supabase' ? 'Supabase URL' : 'Host'}</label>
              <input
                className="acl-input"
                value={vectorHost}
                onChange={(e) => setVectorHost(e.target.value)}
                placeholder={vectorType === 'supabase' ? 'https://xxx.supabase.co' : 'db.example.com'}
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
            {vectorPassword && !vectorResult?.success && (
              <p className="acl-hint">
                A new key has to test green before it can be saved — it is write-only from here, so a
                bad one would stay invisible until a customer&rsquo;s next query failed.
              </p>
            )}
          </section>

          {saveError && <div className="acl-error">{saveError}</div>}

          <div className="acl-actions">
            <button className="acl-btn-cancel" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary" onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : 'Save status & database'}
            </button>
          </div>

          <DangerZone
            accountId={accountId}
            accountName={accountName}
            hasTenant={Boolean(tenant)}
            onDeleted={onDeleted}
            onClose={onClose}
          />
        </>
      )}
    </div>
  );
}

/**
 * Delete, behind a typed confirmation.
 *
 * A single "Are you sure?" is one stray click from destroying an account, and
 * this button used to sit inline in a table row where the click before it was
 * "toggle a module". Typing the word makes the act deliberate and, more
 * importantly, makes you read WHICH account you are on.
 */
function DangerZone({
  accountId,
  accountName,
  hasTenant,
  onDeleted,
  onClose,
}: {
  accountId: string;
  accountName: string;
  hasTenant: boolean;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const armed = typed.trim().toUpperCase() === 'DELETE';

  async function remove() {
    if (!armed) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/accounts/${accountId}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(d.detail || `HTTP ${res.status}`);
      }
      onDeleted();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="acl-section">
        <button className="acl-disclosure acl-disclosure--danger" onClick={() => setOpen(true)}>
          Danger zone — delete this Ask Paul account
        </button>
      </div>
    );
  }

  return (
    <div className="acl-section acl-section--danger">
      <h3 className="acl-section-title">Danger zone</h3>
      <p className="acl-hint acl-hint--warn">
        Deleting <strong>{accountName}</strong> removes its master account record — the Ask Paul
        account, its database credentials, its LLM key and its sign-in methods.{' '}
        {hasTenant ? (
          <>
            Its <strong>traceability</strong> data is not touched and the tenant keeps working; remove
            that separately from the <em>Traceability</em> tab.
          </>
        ) : (
          'It has no traceability tenant, so nothing else refers to it.'
        )}{' '}
        The tenant&rsquo;s Supabase project is <strong>not</strong> de-provisioned either, and keeps
        costing money until someone removes it by hand.
      </p>
      <div className="acl-field-row">
        <label className="acl-label" htmlFor="acl-del">
          Type <code>DELETE</code> to confirm
        </label>
        <input
          id="acl-del"
          className="acl-input"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="DELETE"
          autoComplete="off"
          disabled={busy}
        />
      </div>
      {error && <div className="acl-error">{error}</div>}
      <div className="acl-inline-actions">
        <button className="acl-btn-cancel" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
        <button className="btn-danger-sm" disabled={!armed || busy} onClick={() => void remove()}>
          {busy ? 'Deleting…' : `Delete ${accountName}`}
        </button>
      </div>
    </div>
  );
}
