'use client';

import { useState } from 'react';
import OrcanosPanel from './OrcanosPanel';
import TraceabilityPanel from './TraceabilityPanel';
import AskPaulPanel from './AskPaulPanel';
import LlmPanel from './LlmPanel';
import SpendPanel from './SpendPanel';
import MoveRegionPanel from './MoveRegionPanel';
import { REGION_LABELS, coerceRegion } from '@/lib/regions';
import type { AccountRow, MergedAccountRow, TraceSourceStatus } from '@/lib/types';

/**
 * ONE screen per account.
 *
 * ## Why this exists
 *
 * The list used to offer three different doors per row, and which ones appeared
 * depended on facts the operator could not see. Clicking the name now opens
 * everything that exists for that account, and a capability the account does not
 * have is a disabled tab with the reason on it rather than a button that silently
 * is not there.
 *
 * ## The tabs are one per system, not one per table
 *
 * The first cut of this window split by *where a setting was stored*, which put
 * two different applications' settings in the same tab and the same
 * application's settings in two: Ask Paul's licence sat inside the Traceability
 * dialog (it is a column on the trace row), while Ask Paul's database and kill
 * switch sat under "Account & databases" (they are columns on the master
 * account). An operator had to know the storage layout to find anything.
 *
 * Now each tab is one thing an operator thinks about:
 *
 * | Tab | What it is |
 * |---|---|
 * | Overview | Where the data is, what is licensed, and the region move |
 * | Orcanos | The customer's own Orcanos server — the API both apps hang off, and what identifies the tenant |
 * | Traceability | The traceability app's access gates and modules |
 * | Ask Paul | The QMS AI app: licence, kill switch, database, and deleting the account |
 * | LLM | Both AI configurations — traceability's engine and Ask Paul's key |
 * | Spend | Both AI ledgers |
 *
 * ⚠️ **Tabs are mounted lazily and unmounted when you leave them.** Deliberate:
 * each loads live data on mount, so switching back re-reads rather than showing a
 * snapshot from when the window opened — which matters more now that three tabs
 * read the same trace row and can each change part of it.
 */

type TabKey = 'overview' | 'orcanos' | 'trace' | 'askpaul' | 'llm' | 'spend';

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

  const noMaster =
    'This tenant exists in traceability only — it has no master account record.';

  const tabs: Array<{ key: TabKey; label: string; enabled: boolean; why?: string }> = [
    { key: 'overview', label: 'Overview', enabled: true },
    {
      key: 'orcanos',
      label: 'Orcanos',
      enabled: hasMaster,
      why: `${noMaster} The Orcanos server address and credentials are stored on that record.`,
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
      key: 'askpaul',
      label: 'Ask Paul',
      // The licence lives on the trace row and the database on the master row —
      // either one alone is worth showing, with the missing half explained inside.
      enabled: hasMaster || hasTrace,
      why: 'Ask Paul needs either a master account record or a traceability tenant, and this account has neither.',
    },
    {
      key: 'llm',
      label: 'LLM',
      enabled: hasMaster || hasTrace,
      why: 'There is neither a master account record nor a traceability tenant to hold an AI configuration.',
    },
    {
      key: 'spend',
      label: 'Spend',
      enabled: hasMaster || hasTrace,
      why: 'Neither ledger exists for this account.',
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

        {tab === 'overview' && <Overview row={row} onChanged={onChanged} />}

        {tab === 'orcanos' && row.id && (
          <OrcanosPanel
            accountId={row.id}
            onSaved={(patch) => onChanged(patch)}
            onClose={onClose}
          />
        )}

        {tab === 'trace' && row.tenant && (
          <TraceabilityPanel tenant={row.tenant} onSaved={() => onChanged()} />
        )}

        {tab === 'askpaul' && (
          <AskPaulPanel
            accountId={row.id ?? null}
            accountName={row.account_name}
            tenant={row.tenant ?? null}
            onSaved={(patch) => onChanged(patch)}
            onDeleted={onDeleted}
            onClose={onClose}
          />
        )}

        {tab === 'llm' && (
          <LlmPanel
            accountId={row.id ?? null}
            tenant={row.tenant ?? null}
            onSaved={() => onChanged()}
          />
        )}

        {tab === 'spend' && <SpendPanel accountId={row.id ?? null} tenant={row.tenant ?? null} />}
      </div>
    </div>
  );
}

function Overview({
  row,
  onChanged,
}: {
  row: MergedAccountRow;
  onChanged: () => void;
}) {
  /**
   * The move is collapsed, and starts closed every time.
   *
   * A customer is moved between regions **once, if ever** — it is the rarest
   * thing on this screen and the only one that deletes data at the end. Left
   * expanded it was the largest block on the tab an operator opens by default,
   * with a red warning and a type-the-name box, which makes a routine screen
   * read as dangerous and makes the actual danger ordinary. Behind a button it
   * is one deliberate click away and nothing else changes.
   */
  const [moveOpen, setMoveOpen] = useState(false);

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
            No region on record. This account exists in neither a regional traceability instance nor
            with a region on its master record, so nothing can say where its data is.
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
            traceability data is in one region while the master record says another. Either the data
            was moved and the record not updated, or the record was changed and the data never moved.
            Do not treat either as correct until you have checked which instance actually holds its
            panels.
          </p>
        )}

      </div>

      {/* Its own section rather than a nested one, so the collapsed state is a
          single quiet line and the expanded state is a full-width block. */}
      {!moveOpen ? (
        <div className="acl-section">
          <button className="acl-disclosure" onClick={() => setMoveOpen(true)}>
            Move this account to another region…
          </button>
        </div>
      ) : (
        <>
          <MoveRegionPanel row={row} onMoved={onChanged} />
          <div className="acl-section">
            <button className="acl-disclosure" onClick={() => setMoveOpen(false)}>
              Hide the region move
            </button>
          </div>
        </>
      )}

      <div className="acl-section">
        <h3 className="acl-section-title">Modules</h3>
        <p className="acl-hint">
          Licences are toggled from the pills on the account list, and in detail on the{' '}
          <em>Traceability</em> and <em>Ask Paul</em> tabs.
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
    </div>
  );
}

function ModuleState({ value }: { value: boolean | null }) {
  // null is "no answer from the source that owns this licence" — a dash, never an
  // unticked box. Unknown is not the same as off (lib/modules.ts).
  if (value === null) return <span className="acl-muted">— not known</span>;
  return <strong>{value ? 'Licensed' : 'Not licensed'}</strong>;
}
