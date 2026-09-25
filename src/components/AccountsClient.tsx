'use client';

import { useCallback, useEffect, useState } from 'react';
import AccountManageModal from './AccountManageModal';
import CreateAccountModal from './CreateAccountModal';
import { MODULES } from '@/lib/module-catalog';
import { APP_URLS, REGION_LABELS, coerceRegion } from '@/lib/regions';
import type { MergedAccountRow, ModuleKey, TraceSourceStatus } from '@/lib/types';

/**
 * The merged account list: master Supabase unioned with the traceability-matrix
 * allowlist. `lib/modules.ts` explains the union and the merge key.
 *
 * The two pill columns answer different questions, and conflating them was a
 * real bug here until 2026-08-29 (see `lib/modules.ts`):
 *
 *   Status  — master `is_active`, which is QMS AI's kill switch and NOTHING
 *             else. It does not gate traceability. Read the warning in
 *             `lib/modules.ts` before relabelling or reusing it.
 *   Modules — which products the account is licensed for, all three from
 *             `account_access`. Ask Paul IS the QMS AI app.
 *
 * Two things this component has to get right, both of which are about not
 * lying to the operator:
 *
 *  - A module whose source has no row for the tenant renders as a DASH, not as
 *    an unticked box. "We don't know" and "licensed off" are different answers
 *    and only one of them is a decision somebody made.
 *  - A toggle that cannot be written is disabled with the reason in its
 *    tooltip, rather than being clickable and silently doing nothing. The trace
 *    API has no PATCH and ignores unknown fields, so a write to an instance
 *    older than 3.23.0 would report success and discard the flag.
 *
 * Carried over from the QMS original: click-to-toggle status pill, two-step
 * inline delete, cost opens billing, and load failures are SHOWN.
 */
export default function AccountsClient() {
  const [accounts, setAccounts] = useState<MergedAccountRow[]>([]);
  const [trace, setTrace] = useState<TraceSourceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  /** The one account screen. Every row opens this; the tabs inside are the old dialogs. */
  const [manage, setManage] = useState<MergedAccountRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 5000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await fetch('/api/accounts', { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(
          res.status === 404
            ? 'Not authorised for the platform console.'
            : `Could not load accounts (HTTP ${res.status})`,
        );
      }
      const data = (await res.json()) as {
        accounts: MergedAccountRow[];
        trace: TraceSourceStatus;
      };
      setAccounts(data.accounts ?? []);
      setTrace(data.trace ?? null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Why a reload instead of an optimistic flip: a trace write is a
   * read-modify-write of the whole row, so the authoritative state after a save
   * is whatever that row now says — not what we guessed it would say.
   */
  async function toggleModule(row: MergedAccountRow, key: ModuleKey, next: boolean) {
    const busyKey = `${row.key}:${key}`;
    setBusy(busyKey);
    try {
      const res = await fetch('/api/accounts/modules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module: key,
          enabled: next,
          // Ask Paul writes master AND trace; the others only trace.
          account_id: row.id,
          tenant: row.tenant,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { detail?: string };
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      await load();
    } catch (e) {
      showToast(`✗ ${e instanceof Error ? e.message : String(e)}`);
      // Reload on failure too: an Ask Paul write spans two systems with no shared
      // transaction, so a rejected call may still have moved one half. What the
      // sources now say is the only trustworthy answer.
      await load();
    }
    setBusy(null);
  }

  const needle = search.trim().toLowerCase();
  const filtered = accounts.filter(
    (a) =>
      a.account_name.toLowerCase().includes(needle) ||
      (a.tenant ?? '').toLowerCase().includes(needle),
  );

  return (
    <>
      <div className="app-page-header">
        <div>
          <h1>Accounts</h1>
          <p className="app-page-sub">
            Every tenant on the platform — the modules they are licensed for, their databases,
            status and spend.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setCreateOpen(true)}>
          + Create Account
        </button>
      </div>

      {trace?.message && (
        <div className={`acl-notice ${trace.available ? '' : 'acl-notice--warn'}`}>
          <strong>Traceability:</strong> {trace.message}
          {trace.url && <span className="acl-notice-src"> — {trace.url}</span>}
        </div>
      )}

      <div className="app-card">
        <div className="acl-toolbar">
          <input
            className="acl-search"
            placeholder="Search accounts or tenants…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="acl-btn-cancel" onClick={() => void load()} disabled={loading}>
            {loading ? 'Loading…' : '↺ Refresh'}
          </button>
        </div>

        {loadError ? (
          <div style={{ padding: 20 }}>
            <div className="acl-error" style={{ marginBottom: 0 }}>
              {loadError}
            </div>
          </div>
        ) : loading ? (
          <p className="acl-empty">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="acl-empty">{accounts.length === 0 ? 'No accounts yet.' : 'No matches.'}</p>
        ) : (
          <table className="acl-table">
            <thead>
              <tr>
                <th>Account Name</th>
                <th>Tenant</th>
                <th>Region</th>
                <th>Modules</th>
                <th style={{ textAlign: 'right' }}>Spend</th>
                <th style={{ textAlign: 'right' }}>Tokens</th>
                <th style={{ textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const spend = row.total_cost_usd + row.trace_cost_usd;
                const tokens = row.total_tokens + row.trace_tokens;
                return (
                  <tr key={row.key} className="acl-row">
                    <td>
                      {/* The name is the way in, for EVERY row — including a
                          traceability-only tenant, which used to have no way in
                          at all because it has no master record to "edit". */}
                      <button className="acl-name-link" onClick={() => setManage(row)}>
                        {row.account_name}
                      </button>
                      {!row.id && (
                        <span
                          className="acl-badge acl-badge--muted"
                          style={{ marginLeft: 8 }}
                          title="Present in the traceability allowlist only — it has no master account record."
                        >
                          Trace only
                        </span>
                      )}
                    </td>

                    <td className="acl-tenant">{row.tenant || '—'}</td>

                    <td>
                      {row.region ? (
                        <span
                          className="acl-badge acl-badge--region"
                          title={
                            row.region_source === 'instance'
                              ? 'Read from the traceability instance that actually holds this data.'
                              : 'Recorded on the master account record.'
                          }
                        >
                          {REGION_LABELS[coerceRegion(row.region)].label}
                        </span>
                      ) : (
                        <span className="acl-muted" title="No region on record for this account.">
                          —
                        </span>
                      )}
                      {/* Master and the instance disagree — one of them is wrong
                          and nothing here can tell which. Never resolved silently. */}
                      {row.region_mismatch && (
                        <span
                          className="acl-badge acl-badge--warn"
                          style={{ marginLeft: 6 }}
                          title="The master record and the instance holding the data name different regions. Check which instance actually has its panels."
                        >
                          conflict
                        </span>
                      )}
                    </td>

                    <td>
                      <div className="acl-mods">
                        {MODULES.map((m) => (
                          <ModuleCell
                            key={m.key}
                            label={m.label}
                            state={row.modules[m.key]}
                            busy={busy === `${row.key}:${m.key}`}
                            reason={disabledReason(row, m.key, trace)}
                            note={scopeNote(row, m.key, trace)}
                            onToggle={(next) => void toggleModule(row, m.key, next)}
                          />
                        ))}
                      </div>
                    </td>

                    <td className="acl-num">
                      {row.id ? (
                        <button
                          className="acl-cost-link"
                          onClick={() => setManage(row)}
                          title={`QMS AI $${row.total_cost_usd.toFixed(4)} · Traceability $${row.trace_cost_usd.toFixed(4)}`}
                        >
                          ${spend.toFixed(4)}
                        </button>
                      ) : (
                        <span title={`Traceability $${row.trace_cost_usd.toFixed(4)}`}>
                          ${spend.toFixed(4)}
                        </span>
                      )}
                    </td>

                    <td className="acl-num acl-muted">{tokens.toLocaleString()}</td>

                    <td style={{ textAlign: 'center' }}>
                      {/* One door per row. Which capabilities exist is decided
                          INSIDE that screen, where the reason a tab is disabled
                          can actually be shown — the old row offered a different
                          set of buttons per account with nothing explaining why. */}
                      <div className="acl-row-actions">
                        <OpenLink label="Ask Paul" row={row} app="ask_paul" />
                        <OpenLink label="Traceability" row={row} app="traceability" />
                        <button className="btn-sm" onClick={() => setManage(row)}>
                          Manage…
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {createOpen && (
        <CreateAccountModal
          // Both halves of the merged list: a master account name and a
          // traceability tenant occupy the same namespace here, and reusing
          // either produces a row that is not the account that was just created.
          existingNames={accounts.flatMap((a) => [a.account_name, a.tenant ?? ''])}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            void load();
            showToast('✓ Account created');
          }}
        />
      )}

      {manage && (
        <AccountManageModal
          row={manage}
          trace={trace}
          onClose={() => setManage(null)}
          onChanged={() => void load()}
          onDeleted={() => {
            showToast('✓ Account deleted');
            void load();
          }}
        />
      )}

      {toast && (
        <div className={`acl-toast ${toast.startsWith('✓') ? 'acl-toast--ok' : 'acl-toast--err'}`}>
          {toast}
        </div>
      )}
    </>
  );
}

/**
 * Which halves of the Ask Paul switch this row can actually write.
 *
 * `app` is master `is_active` — the kill switch. `handoff` is trace
 * `allow_ask_paul` — the button into it from traceability. Most rows have only
 * one of the two (12 of 15 accounts are trace-only), so one half missing is
 * normal, not an error.
 */
function askPaulHalves(row: MergedAccountRow, trace: TraceSourceStatus | null) {
  return {
    app: Boolean(row.id),
    handoff: Boolean(
      trace?.available &&
        trace.supports_ask_paul &&
        row.tenant &&
        row.trace_present &&
        row.trace_allow_access,
    ),
  };
}

/**
 * Why a toggle is not clickable, in the operator's words. Returning '' means
 * it IS clickable. Every branch here is a real state the merged list produces —
 * none of them is theoretical.
 */
function disabledReason(
  row: MergedAccountRow,
  key: ModuleKey,
  trace: TraceSourceStatus | null,
): string {
  // Ask Paul is clickable if EITHER half can be written; the tooltip below says
  // which. Falling through to the traceability branches would wrongly disable it
  // for a master-only account whose kill switch is perfectly writable.
  if (key === 'ask_paul') {
    const { app, handoff } = askPaulHalves(row, trace);

    // Ask Paul is the only module with a per-tenant database and is useless
    // without one, so it cannot be licensed until the account has one. Only
    // turning it ON is blocked — a click on a pill that is already licensed
    // turns it off, which must always be possible, and a dash would turn it on.
    if (row.modules.ask_paul !== true && !row.has_database) {
      return row.id
        ? 'No database on this account — Ask Paul has nowhere to read from. Add one under Edit → Vector DB first.'
        : 'No master account record, so this tenant has no Ask Paul database. Create the account and give it one first.';
    }

    if (app || handoff) return '';
    if (!trace?.available) {
      return 'No master account record, and the traceability instance is not reachable.';
    }
    if (!trace.supports_ask_paul) {
      return 'No master account record, and this traceability instance predates the Ask Paul licence (3.27.0).';
    }
    if (!row.tenant) return 'No Orcanos tenant on this account — set its Orcanos API URL first.';
    if (!row.trace_present) {
      return (
        `Tenant '${row.tenant}' is not in the traceability allowlist, so there is no hand-off ` +
        `to license. Turn on Traceability or Training first — that adds the tenant.`
      );
    }
    return `Sign-in is disabled for '${row.tenant}' in traceability, so the hand-off is unreachable.`;
  }

  if (!trace?.available) return 'The traceability instance is not reachable.';
  if (!trace.supports_modules) {
    return 'This traceability instance predates per-module licences — deploy 3.23.0 first.';
  }
  // Only turning BOM ON needs the column; an instance without it already reads
  // as off everywhere, so there is nothing to turn off.
  if (key === 'bom' && !trace.supports_bom && row.modules.bom !== true) {
    return 'This traceability instance predates the BOM licence — deploy 3.46.0 first.';
  }
  if (!row.tenant) return 'No Orcanos tenant on this account — set its Orcanos API URL first.';
  // A tenant with no allowlist row is NOT a dead end any more: licensing either
  // traceability-owned module creates the row (api/accounts/modules). It stays
  // clickable, and `scopeNote` says that is what the click will do.
  if (!row.trace_present) return '';
  if (!row.trace_allow_access) {
    return `Sign-in is disabled for '${row.tenant}' in traceability, so no module is reachable.`;
  }
  return '';
}

/**
 * What a click will actually change, when that is less than the whole switch.
 * A half-write is a legitimate outcome, so it is said up front rather than
 * discovered afterwards in a toast.
 */
function scopeNote(row: MergedAccountRow, key: ModuleKey, trace: TraceSourceStatus | null): string {
  // Adding a tenant to the allowlist grants it sign-in to traceability, which is
  // more than the pill's label suggests. Said before the click, not after.
  if (key !== 'ask_paul' && row.tenant && !row.trace_present && trace?.available) {
    return (
      ` — this also ADDS '${row.tenant}' to the traceability allowlist, which lets it sign in.` +
      ` The other modules stay unlicensed.`
    );
  }

  if (key !== 'ask_paul') return '';
  const { app, handoff } = askPaulHalves(row, trace);
  if (app && handoff) return '';
  if (app) return ' — this changes the app itself only, not the traceability hand-off.';
  if (handoff) return ' — this changes the traceability hand-off only; the account has no master record.';
  return '';
}

function ModuleCell({
  label,
  state,
  busy,
  reason,
  note,
  onToggle,
}: {
  label: string;
  state: boolean | null;
  busy: boolean;
  reason: string;
  note: string;
  onToggle: (next: boolean) => void;
}) {
  // null is "this source has no row for the tenant" — deliberately not the same
  // rendering as off, which is a decision somebody made.
  const cls = state === null ? 'acl-mod--na' : state ? 'acl-mod--on' : 'acl-mod--off';
  // `null` is not "off", so it must not read as "not licensed" — that is the same
  // conflation the dash exists to avoid.
  const status = state === null ? 'no licence on record' : state ? 'licensed' : 'not licensed';
  const title = reason || `${label}: ${status} — click to change${note}`;

  return (
    <button
      className={`acl-mod ${cls}`}
      disabled={Boolean(reason) || busy}
      title={title}
      onClick={() => onToggle(!state)}
    >
      <span className="acl-mod-mark">{busy ? '⋯' : state === null ? '–' : state ? '✓' : '✗'}</span>
      {label}
    </button>
  );
}

/**
 * Opens the product in a new tab at the deployment for this row's region. A row
 * with no region on record is US — `coerceRegion`, same as everywhere else. A
 * product with no deployment in that region is shown disabled rather than
 * pointing at the other region's app.
 */
function OpenLink({
  label,
  row,
  app,
}: {
  label: string;
  row: MergedAccountRow;
  app: 'ask_paul' | 'traceability';
}) {
  const region = coerceRegion(row.region);
  const url = APP_URLS[region][app];
  const where = region.toUpperCase();
  if (!url) {
    return (
      <button className="btn-sm" disabled title={`${label} has no ${where} deployment yet.`}>
        {label} ↗
      </button>
    );
  }
  return (
    <a
      className="btn-sm"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${label} (${where}) — ${url}`}
    >
      {label} ↗
    </a>
  );
}
