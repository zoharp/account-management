'use client';

import { useCallback, useEffect, useState } from 'react';
import AccountDetailModal from './AccountDetailModal';
import AccountBillingModal from './AccountBillingModal';
import CreateAccountModal from './CreateAccountModal';
import TraceSettingsModal from './TraceSettingsModal';
import { MODULES } from '@/lib/module-catalog';
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
  const [selected, setSelected] = useState<MergedAccountRow | null>(null);
  const [billing, setBilling] = useState<MergedAccountRow | null>(null);
  const [traceSettings, setTraceSettings] = useState<MergedAccountRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
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

  async function remove(id: string) {
    try {
      const res = await fetch(`/api/accounts/${id}`, { method: 'DELETE' });
      const data = (await res.json().catch(() => ({}))) as { warning?: string };
      if (!res.ok) throw new Error();
      setConfirmDelete(null);
      showToast('✓ Account deleted');
      if (data.warning) {
        // Kept visible far longer than a normal toast — this one costs money.
        setTimeout(() => showToast(`⚠ ${data.warning}`), 100);
      }
      await load();
    } catch {
      showToast('✗ Delete failed');
    }
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
                  <tr
                    key={row.key}
                    className="acl-row"
                    onClick={() => row.id && setSelected(row)}
                    style={row.id ? undefined : { cursor: 'default' }}
                  >
                    <td>
                      <strong>{row.account_name}</strong>
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

                    <td onClick={(e) => e.stopPropagation()}>
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

                    <td className="acl-num" onClick={(e) => e.stopPropagation()}>
                      {row.id ? (
                        <button
                          className="acl-cost-link"
                          onClick={() => setBilling(row)}
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

                    <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                      {/* Available for a traceability-only tenant too — that is
                          the whole point of merging the lists, and those rows
                          have no master record to edit. */}
                      {row.tenant && trace?.available && (
                        <button
                          className="btn-sm"
                          style={{ marginRight: 6 }}
                          onClick={() => setTraceSettings(row)}
                          title="Access, modules, AI engine and spend for this tenant in traceability"
                        >
                          Traceability…
                        </button>
                      )}
                      {row.id ? (
                        <>
                          <button
                            className="btn-sm"
                            style={{ marginRight: 6 }}
                            onClick={() => setSelected(row)}
                          >
                            Edit
                          </button>
                          {confirmDelete === row.id ? (
                            <>
                              <span style={{ fontSize: 12, marginRight: 4 }}>Delete?</span>
                              <button
                                className="btn-danger-sm"
                                style={{ marginRight: 4 }}
                                onClick={() => void remove(row.id!)}
                              >
                                Yes
                              </button>
                              <button className="btn-sm" onClick={() => setConfirmDelete(null)}>
                                No
                              </button>
                            </>
                          ) : (
                            <button
                              className="btn-danger-sm"
                              onClick={() => setConfirmDelete(row.id)}
                            >
                              Delete
                            </button>
                          )}
                        </>
                      ) : (
                        !row.tenant && (
                          <span
                            className="acl-muted"
                            title="Create a master account record to edit it here."
                          >
                            —
                          </span>
                        )
                      )}
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
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            void load();
            showToast('✓ Account created');
          }}
        />
      )}

      {selected?.id && (
        <AccountDetailModal
          accountId={selected.id}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            void load();
            showToast('✓ Account saved');
          }}
        />
      )}

      {billing?.id && (
        <AccountBillingModal
          accountId={billing.id}
          accountName={billing.account_name}
          onClose={() => setBilling(null)}
        />
      )}

      {traceSettings?.tenant && (
        <TraceSettingsModal
          tenant={traceSettings.tenant}
          accountName={traceSettings.account_name}
          onClose={() => setTraceSettings(null)}
          // Flags here feed the Modules column and the combined spend, so the
          // list has to re-read rather than assume what changed.
          onSaved={() => void load()}
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
    if (app || handoff) return '';
    if (!trace?.available) {
      return 'No master account record, and the traceability instance is not reachable.';
    }
    if (!trace.supports_ask_paul) {
      return 'No master account record, and this traceability instance predates the Ask Paul licence (3.27.0).';
    }
    if (!row.tenant) return 'No Orcanos tenant on this account — set its Orcanos API URL first.';
    if (!row.trace_present) return `Tenant '${row.tenant}' is not in the traceability allowlist.`;
    return `Sign-in is disabled for '${row.tenant}' in traceability, so the hand-off is unreachable.`;
  }

  if (!trace?.available) return 'The traceability instance is not reachable.';
  if (!trace.supports_modules) {
    return 'This traceability instance predates per-module licences — deploy 3.23.0 first.';
  }
  if (!row.tenant) return 'No Orcanos tenant on this account — set its Orcanos API URL first.';
  if (!row.trace_present) return `Tenant '${row.tenant}' is not in the traceability allowlist.`;
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
  const title =
    reason || `${label}: ${state ? 'licensed' : 'not licensed'} — click to change${note}`;

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
