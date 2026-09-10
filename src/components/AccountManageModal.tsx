'use client';

import { useState } from 'react';
import AccountDetailModal from './AccountDetailModal';
import AccountBillingModal from './AccountBillingModal';
import TraceSettingsModal from './TraceSettingsModal';
import MoveRegionPanel from './MoveRegionPanel';
import { REGION_LABELS, coerceRegion } from '@/lib/regions';
import type { AccountRow, MergedAccountRow, TraceSourceStatus } from '@/lib/types';

/**
 * ONE screen per account.
 *
 * ## Why this exists
 *
 * The list used to offer three different doors per row, and which ones appeared
 * depended on facts the operator could not see: **Traceability…** only when the
 * tenant had an allowlist row, **Edit** and **Delete** only when the account had
 * a *master* record — which most tenants do not. So the row for a
 * traceability-only customer showed one button, the row for a full customer
 * showed three, and nothing on screen explained the difference. Clicking the name
 * now opens everything that exists for that account, and a capability the account
 * does not have is a disabled tab with the reason on it rather than a button that
 * silently is not there.
 *
 * ## How the tabs are built
 *
 * Each tab is the SAME component that used to be its own dialog, rendered with
 * `embedded` so it draws no window of its own (see `ModalShell`). They are not
 * reimplemented here — their save logic, their three-state secret handling and
 * their invariants stay in one place. This file owns only the frame, the tab
 * strip, and the two things that belong to no single tab: moving the account
 * between data regions, and deleting it.
 *
 * ⚠️ **Tabs are mounted lazily and unmounted when you leave them.** That is
 * deliberate: each one loads live data on mount, so switching back re-reads
 * rather than showing a snapshot from when the window opened — and an edit made
 * on the Traceability tab is visible on Overview immediately after.
 */

type TabKey = 'overview' | 'account' | 'trace' | 'billing';

export default function AccountManageModal({
  row,
  trace,
  onClose,
  onChanged,
  onDeleted,
}: {
  row: MergedAccountRow;
  trace: TraceSourceStatus | null;
  onClose: () => void;
  /** Something inside changed; the list should reload. */
  onChanged: (patch?: Partial<AccountRow>) => void;
  onDeleted: () => void;
}) {
  const [tab, setTab] = useState<TabKey>('overview');

  const hasMaster = Boolean(row.id);
  const hasTrace = Boolean(row.tenant && trace?.available);

  const tabs: Array<{ key: TabKey; label: string; enabled: boolean; why?: string }> = [
    { key: 'overview', label: 'Overview', enabled: true },
    {
      key: 'account',
      label: 'Account & databases',
      enabled: hasMaster,
      why: 'This tenant exists in traceability only — it has no master account record, so there are no databases or Orcanos credentials to edit.',
    },
    {
      key: 'trace',
      label: 'Traceability',
      enabled: hasTrace,
      why: !row.tenant
        ? 'This account has no Orcanos tenant, so there is nothing in traceability to configure.'
        : 'The traceability instance is not reachable right now.',
    },
    {
      key: 'billing',
      label: 'Spend',
      enabled: hasMaster,
      why: 'Spend detail comes from the master account record, which this tenant does not have.',
    },
  ];

  return (
    <div className="acl-overlay" onClick={onClose}>
      <div className="acl-modal acl-modal--manage" onClick={(e) => e.stopPropagation()}>
        <div className="acl-header">
          <div>
            <h2>{row.account_name}</h2>
            <span className="acl-header-sub">
              {row.tenant ? (
                <>
                  tenant <code>{row.tenant}</code>
                </>
              ) : (
                'no Orcanos tenant'
              )}
              {row.region && (
                <>
                  {' · '}
                  {REGION_LABELS[coerceRegion(row.region)].label}
                </>
              )}
            </span>
          </div>
          <button className="acl-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="acl-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={`acl-tab${tab === t.key ? ' acl-tab--active' : ''}`}
              disabled={!t.enabled}
              title={t.enabled ? undefined : t.why}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <Overview row={row} onChanged={onChanged} onDeleted={onDeleted} onClose={onClose} />
        )}

        {tab === 'account' && row.id && (
          <AccountDetailModal
            embedded
            accountId={row.id}
            onSaved={(patch) => onChanged(patch)}
            onClose={onClose}
          />
        )}

        {tab === 'trace' && row.tenant && (
          <TraceSettingsModal
            embedded
            tenant={row.tenant}
            accountName={row.account_name}
            onSaved={() => onChanged()}
            onClose={onClose}
          />
        )}

        {tab === 'billing' && row.id && (
          <AccountBillingModal
            embedded
            accountId={row.id}
            accountName={row.account_name}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

function Overview({
  row,
  onChanged,
  onDeleted,
  onClose,
}: {
  row: MergedAccountRow;
  onChanged: () => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  return (
    <div className="acl-detail-body">
      <div className="acl-section">
        <h3 className="acl-section-title">Where this account&rsquo;s data is</h3>

        {row.region ? (
          <>
            <p className="acl-kv">
              <span className="acl-badge acl-badge--region">
                {REGION_LABELS[coerceRegion(row.region)].label}
              </span>{' '}
              <span className="acl-muted">
                {row.region_source === 'instance'
                  ? '— read from the traceability instance that actually holds it'
                  : '— recorded on the master account record'}
              </span>
            </p>
            <p className="acl-hint">{REGION_LABELS[coerceRegion(row.region)].hint}</p>
          </>
        ) : (
          <p className="acl-hint acl-hint--warn">
            No region on record. This account exists in neither a regional traceability instance
            nor with a region on its master record, so nothing can say where its data is.
          </p>
        )}

        {/*
          Master and the instance disagree. One of them is wrong and the console
          cannot tell which — resolving it silently is how a residency claim stays
          plausible while being false.
        */}
        {row.region_mismatch && (
          <p className="acl-hint acl-hint--warn">
            <strong>The two sources disagree about this account&rsquo;s region.</strong> Its
            traceability data is in one region while the master record says another. Either the
            data was moved and the record not updated, or the record was changed and the data never
            moved. Do not treat either as correct until you have checked which instance actually
            holds its panels.
          </p>
        )}
      </div>

      <MoveRegionPanel row={row} onMoved={onChanged} />

      <div className="acl-section">
        <h3 className="acl-section-title">Modules</h3>
        <p className="acl-hint">
          Licences are toggled from the pills on the account list, and in detail on the{' '}
          <em>Traceability</em> tab.
        </p>
        <ul className="acl-kv-list">
          <li>
            Traceability: <ModuleState value={row.modules.trace} />
          </li>
          <li>
            Training: <ModuleState value={row.modules.training} />
          </li>
          <li>
            Ask Paul: <ModuleState value={row.modules.ask_paul} />
          </li>
        </ul>
      </div>

      <DangerZone row={row} onDeleted={onDeleted} onClose={onClose} />
    </div>
  );
}

function ModuleState({ value }: { value: boolean | null }) {
  // null is "no answer from the source that owns this licence" — a dash, never an
  // unticked box. Unknown is not the same as off (lib/modules.ts).
  if (value === null) return <span className="acl-muted">— not known</span>;
  return <strong>{value ? 'Licensed' : 'Not licensed'}</strong>;
}

/**
 * Delete, behind a typed confirmation.
 *
 * A single "Are you sure?" is one stray click from destroying an account, and the
 * button used to sit inline in a table row where the click before it was
 * "toggle a module". Typing the account's own name-independent word makes the act
 * deliberate and, more importantly, makes you read WHICH account you are on.
 */
function DangerZone({
  row,
  onDeleted,
  onClose,
}: {
  row: MergedAccountRow;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const armed = typed.trim().toUpperCase() === 'DELETE';

  async function remove() {
    if (!armed || !row.id) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/accounts/${row.id}`, { method: 'DELETE' });
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

  if (!row.id) {
    return (
      <div className="acl-section">
        <h3 className="acl-section-title">Danger zone</h3>
        <p className="acl-hint">
          This tenant has no master account record, so there is nothing to delete here. Its
          traceability allowlist entry is removed from the <em>Traceability</em> tab.
        </p>
      </div>
    );
  }

  return (
    <div className="acl-section acl-section--danger">
      <h3 className="acl-section-title">Danger zone</h3>
      <p className="acl-hint acl-hint--warn">
        Deleting <strong>{row.account_name}</strong> removes its master account record. Its
        traceability data is <strong>not</strong> deleted by this and has to be removed separately
        from the <em>Traceability</em> tab.
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
      <button className="btn-danger-sm" disabled={!armed || busy} onClick={() => void remove()}>
        {busy ? 'Deleting…' : `Delete ${row.account_name}`}
      </button>
    </div>
  );
}
