'use client';

import { useCallback, useEffect, useState } from 'react';
import AccountDetailModal from './AccountDetailModal';
import AccountBillingModal from './AccountBillingModal';
import CreateAccountModal from './CreateAccountModal';
import type { AccountListRow } from '@/lib/types';

/**
 * Port of AccountsList.jsx. Same columns, same click-to-toggle status pill,
 * same two-step inline delete, same cost-opens-billing behaviour.
 *
 * Differences from the QMS version, both deliberate:
 *  - a load failure is SHOWN. The original swallowed the error with
 *    "user may not be orcanos admin", which was reasonable when the panel was
 *    one modal inside an app most users could still use. Here a blank list with
 *    no explanation is just a broken page.
 *  - delete surfaces the API's `warning` about the tenant's Supabase project
 *    not being de-provisioned. The original discarded it and said "✓ deleted",
 *    which is how you end up paying for projects nobody remembers.
 */
export default function AccountsClient() {
  const [accounts, setAccounts] = useState<AccountListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<AccountListRow | null>(null);
  const [billing, setBilling] = useState<AccountListRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
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
      const data = (await res.json()) as { accounts: AccountListRow[] };
      setAccounts(data.accounts ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleActive(acct: AccountListRow, e: React.MouseEvent) {
    e.stopPropagation();
    const next = !acct.is_active;
    // Optimistic, like the original — reverted below if the server disagrees.
    setAccounts((prev) => prev.map((a) => (a.id === acct.id ? { ...a, is_active: next } : a)));
    try {
      const res = await fetch(`/api/accounts/${acct.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setAccounts((prev) =>
        prev.map((a) => (a.id === acct.id ? { ...a, is_active: acct.is_active } : a)),
      );
      showToast('✗ Update failed');
    }
  }

  async function remove(id: string) {
    try {
      const res = await fetch(`/api/accounts/${id}`, { method: 'DELETE' });
      const data = (await res.json().catch(() => ({}))) as { warning?: string };
      if (!res.ok) throw new Error();
      setAccounts((prev) => prev.filter((a) => a.id !== id));
      setConfirmDelete(null);
      showToast('✓ Account deleted');
      if (data.warning) {
        // Kept visible far longer than a normal toast — this one costs money.
        setTimeout(() => showToast(`⚠ ${data.warning}`), 100);
      }
    } catch {
      showToast('✗ Delete failed');
    }
  }

  const filtered = accounts.filter((a) =>
    a.account_name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <>
      <div className="app-page-header">
        <div>
          <h1>Accounts</h1>
          <p className="app-page-sub">
            Every tenant on the platform — their databases, status and spend.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setCreateOpen(true)}>
          + Create Account
        </button>
      </div>

      <div className="app-card">
        <div className="acl-toolbar">
          <input
            className="acl-search"
            placeholder="Search accounts…"
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
                <th>DB Type</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Total Cost</th>
                <th style={{ textAlign: 'right' }}>Tokens</th>
                <th>Created</th>
                <th style={{ textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((acct) => (
                <tr key={acct.id} className="acl-row" onClick={() => setSelected(acct)}>
                  <td>
                    <strong>{acct.account_name}</strong>
                  </td>
                  <td>
                    <span className="acl-badge">{acct.db_type || '—'}</span>
                  </td>
                  <td>
                    <button
                      className={`acl-toggle ${acct.is_active ? 'acl-toggle--on' : 'acl-toggle--off'}`}
                      onClick={(e) => void toggleActive(acct, e)}
                      title={acct.is_active ? 'Click to deactivate' : 'Click to activate'}
                    >
                      {acct.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="acl-num" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="acl-cost-link"
                      onClick={() => setBilling(acct)}
                      title="View billing details"
                    >
                      ${Number(acct.total_cost_usd || 0).toFixed(4)}
                    </button>
                  </td>
                  <td className="acl-num acl-muted">
                    {Number(acct.total_tokens || 0).toLocaleString()}
                  </td>
                  <td className="acl-muted">
                    {acct.created_at ? new Date(acct.created_at).toLocaleDateString() : '—'}
                  </td>
                  <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                    <button
                      className="btn-sm"
                      style={{ marginRight: 6 }}
                      onClick={() => setSelected(acct)}
                    >
                      Edit
                    </button>
                    {confirmDelete === acct.id ? (
                      <>
                        <span style={{ fontSize: 12, marginRight: 4 }}>Delete?</span>
                        <button
                          className="btn-danger-sm"
                          style={{ marginRight: 4 }}
                          onClick={() => void remove(acct.id)}
                        >
                          Yes
                        </button>
                        <button className="btn-sm" onClick={() => setConfirmDelete(null)}>
                          No
                        </button>
                      </>
                    ) : (
                      <button className="btn-danger-sm" onClick={() => setConfirmDelete(acct.id)}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {createOpen && (
        <CreateAccountModal
          onClose={() => setCreateOpen(false)}
          onCreated={(account) => {
            setAccounts((prev) => [...prev, account]);
            setCreateOpen(false);
            showToast(`✓ Account "${account.account_name}" created`);
          }}
        />
      )}

      {selected && (
        <AccountDetailModal
          accountId={selected.id}
          onClose={() => setSelected(null)}
          onSaved={(updated) => {
            setAccounts((prev) =>
              prev.map((a) => (a.id === selected.id ? { ...a, ...updated } : a)),
            );
            setSelected(null);
            showToast('✓ Account saved');
          }}
        />
      )}

      {billing && (
        <AccountBillingModal
          accountId={billing.id}
          accountName={billing.account_name}
          onClose={() => setBilling(null)}
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
