'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Who may sign in to this console. A person needs a row here AND to be an admin in the
 * Orcanos tenant they sign in against — this screen supplies the first; Orcanos the second.
 * Removing someone keeps their `users` row (shared with QMS) and only takes away `admin`.
 */

interface StaffRow {
  id: number;
  email: string;
  display_name: string | null;
  role: string;
  orcanos_user_name: string | null;
  orcanos_account: string | null;
  last_login_at: string | null;
}

function status(r: StaffRow): { label: string; cls: string } {
  if (r.role !== 'admin') return { label: 'Removed', cls: 'acl-badge acl-badge--muted' };
  if (!r.orcanos_user_name) return { label: 'No Orcanos username', cls: 'acl-badge acl-badge--warn' };
  if (!r.orcanos_account) return { label: 'Not signed in yet', cls: 'acl-badge acl-badge--muted' };
  return { label: 'Can sign in', cls: 'acl-badge' };
}

export default function StaffClient() {
  const [rows, setRows] = useState<StaffRow[] | null>(null);
  const [domain, setDomain] = useState('orcanos.com');
  const [me, setMe] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [editing, setEditing] = useState<{ id: number; value: string } | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/staff', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setRows(data.staff);
      setDomain(data.domain);
      setMe(data.me);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function call(url: string, method: string, body?: unknown, ok?: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      if (ok) setMsg({ ok: true, text: ok });
      await load();
      return true;
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const added = await call(
      '/api/staff',
      'POST',
      { email, display_name: name, orcanos_user_name: username },
      `${email} can now sign in with their Orcanos password, if they are an admin in Orcanos.`,
    );
    if (added) {
      setEmail('');
      setName('');
      setUsername('');
    }
  }

  async function saveUsername() {
    if (!editing) return;
    const done = await call(`/api/staff/${editing.id}`, 'PATCH', { orcanos_user_name: editing.value }, 'Saved.');
    if (done) setEditing(null);
  }

  async function remove(r: StaffRow) {
    if (!window.confirm(`Remove console access for ${r.email}? This also removes their platform admin role in Ask Paul.`)) return;
    await call(`/api/staff/${r.id}`, 'DELETE', undefined, `${r.email} can no longer sign in.`);
  }

  const visible = (rows ?? []).filter((r) => showRemoved || r.role === 'admin');
  const removedCount = (rows ?? []).filter((r) => r.role !== 'admin').length;
  const canAdd = email.trim().toLowerCase().endsWith(`@${domain}`) && username.trim() !== '';

  return (
    <>
      <div className="app-page-header">
        <div>
          <h1>Staff</h1>
          <p className="app-page-sub">
            Who can sign in to this console. Each person also has to be an <b>admin in Orcanos</b>,
            and signs in with their Orcanos password.
          </p>
        </div>
      </div>

      <div className="app-card" style={{ padding: 24, marginBottom: 18, maxWidth: 760 }}>
        <h3 className="acl-section-title">Add a person</h3>
        <div className="acl-field-row">
          <label className="acl-label" htmlFor="st-email">Email</label>
          <input id="st-email" className="acl-input" type="email" placeholder={`name@${domain}`}
                 value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="acl-field-row">
          <label className="acl-label" htmlFor="st-user">Orcanos username</label>
          <input id="st-user" className="acl-input" placeholder="e.g. jane.doe" autoComplete="off"
                 value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="acl-field-row">
          <label className="acl-label" htmlFor="st-name">Name <span className="acl-muted">(optional)</span></label>
          <input id="st-name" className="acl-input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <p className="acl-hint">
          The username must be exactly the one they use to sign in to Orcanos. Their password is
          checked against it, not against what they type on the sign-in screen. They can then sign
          in with either their email or that username.
        </p>
        <div style={{ marginTop: 12 }}>
          <button className="btn-primary" onClick={() => void add()} disabled={busy || !canAdd}>
            {busy ? 'Saving…' : 'Add'}
          </button>
        </div>
      </div>

      {msg && <div className={msg.ok ? 'acl-hint acl-hint--ok' : 'acl-error'} style={{ marginBottom: 14 }}>{msg.text}</div>}

      <div className="app-card">
        <div className="acl-toolbar">
          <span className="acl-muted">{rows ? `${visible.length} shown` : ''}</span>
          <span style={{ flex: 1 }} />
          {removedCount > 0 && (
            <label className="acl-check">
              <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} />{' '}
              Show removed ({removedCount})
            </label>
          )}
        </div>
        <table className="acl-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Orcanos username</th>
              <th>Status</th>
              <th>Last sign-in</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr><td colSpan={5} className="acl-empty">Loading…</td></tr>
            )}
            {rows && visible.length === 0 && (
              <tr><td colSpan={5} className="acl-empty">Nobody yet.</td></tr>
            )}
            {visible.map((r) => {
              const st = status(r);
              const isEditing = editing?.id === r.id;
              return (
                <tr key={r.id}>
                  <td>
                    {r.email}
                    {r.display_name && <div className="acl-muted">{r.display_name}</div>}
                  </td>
                  <td>
                    {isEditing ? (
                      <span className="acl-inline-actions">
                        <input className="acl-input" value={editing.value} autoFocus
                               onChange={(e) => setEditing({ id: r.id, value: e.target.value })}
                               onKeyDown={(e) => { if (e.key === 'Enter') void saveUsername(); if (e.key === 'Escape') setEditing(null); }} />
                        <button className="btn-sm" disabled={busy || !editing.value.trim()} onClick={() => void saveUsername()}>Save</button>
                        <button className="btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                      </span>
                    ) : (
                      r.orcanos_user_name || <span className="acl-muted">—</span>
                    )}
                  </td>
                  <td>
                    <span className={st.cls}>{st.label}</span>
                    {r.orcanos_account && <div className="acl-muted">tenant {r.orcanos_account}</div>}
                  </td>
                  <td className="acl-muted">{r.last_login_at ? new Date(r.last_login_at).toLocaleString() : '—'}</td>
                  <td>
                    <div className="acl-row-actions">
                      {r.role === 'admin' ? (
                        <>
                          {!isEditing && (
                            <button className="btn-sm" disabled={busy}
                                    onClick={() => setEditing({ id: r.id, value: r.orcanos_user_name ?? '' })}>
                              {r.orcanos_user_name ? 'Change username' : 'Set username'}
                            </button>
                          )}
                          {r.id !== me && (
                            <button className="btn-danger-sm" disabled={busy} onClick={() => void remove(r)}>Remove</button>
                          )}
                        </>
                      ) : (
                        <button className="btn-sm" disabled={busy}
                                onClick={() => void call(`/api/staff/${r.id}`, 'PATCH', { role: 'admin' }, `${r.email} restored.`)}>
                          Restore
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
