'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AuthMethodOption } from '@/lib/types';

/**
 * Port of QMS Auth.jsx, minus the account-picker stage.
 *
 * QMS asks the user which tenant they belong to before offering sign-in
 * methods. This console has exactly one tenant — the platform's own — so the
 * account comes from PLATFORM_ACCOUNT on the server and the user goes straight
 * to method selection.
 *
 * Kept from the original: the CSPRNG `state` parameter stashed in
 * sessionStorage and verified on return. Without it the callback would accept
 * an authorization code from anywhere, which is the classic OAuth CSRF.
 */
export default function LoginClient() {
  const router = useRouter();
  const [methods, setMethods] = useState<AuthMethodOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState('');
  const [mode, setMode] = useState<'choose' | 'local'>('choose');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/config', { cache: 'no-store' });
        const data = (await res.json()) as { methods?: AuthMethodOption[]; detail?: string };
        if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
        setMethods(data.methods ?? []);
        // One method and it is local? Skip the pointless menu.
        if (data.methods?.length === 1 && data.methods[0].type === 'local') setMode('local');
      } catch (e) {
        setConfigError(e instanceof Error ? e.message : String(e));
      }
      setLoading(false);
    })();
  }, []);

  function startOAuth(method: AuthMethodOption) {
    const state = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const redirectUri = `${window.location.origin}/auth/callback`;
    sessionStorage.setItem(
      'oauth_state',
      JSON.stringify({ state, provider: method.type, redirectUri }),
    );

    const params = new URLSearchParams({
      client_id: method.client_id ?? '',
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
    });

    if (method.type === 'google') {
      params.set('scope', 'openid email profile');
      params.set('access_type', 'offline');
      params.set('prompt', 'select_account');
      window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    } else {
      params.set('scope', 'openid profile email User.Read');
      params.set('response_mode', 'query');
      const tenant = method.tenant || 'common';
      window.location.href = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params}`;
    }
  }

  async function signInLocal(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/auth/local/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { detail?: string };
      if (!res.ok) throw new Error(data.detail || 'Sign-in failed');
      router.replace('/accounts');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  const hasLocal = methods.some((m) => m.type === 'local');
  const oauthMethods = methods.filter((m) => m.type !== 'local');

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1 className="login-title">Orcanos Platform</h1>
        <p className="login-sub">Console sign-in</p>

        {loading ? (
          <p className="acl-empty">Loading…</p>
        ) : configError ? (
          <div className="acl-error">{configError}</div>
        ) : methods.length === 0 ? (
          <div className="acl-error">
            No sign-in methods are enabled for the platform account. Enable one on its
            <code> auth_methods </code> row.
          </div>
        ) : mode === 'choose' ? (
          <>
            {oauthMethods.map((m) => (
              <button key={m.type} className="login-method" onClick={() => startOAuth(m)}>
                {m.type === 'google' ? 'Continue with Google' : 'Continue with Microsoft'}
              </button>
            ))}

            {hasLocal && oauthMethods.length > 0 && <div className="login-divider">or</div>}

            {hasLocal && (
              <button className="login-method" onClick={() => setMode('local')}>
                Sign in with email
              </button>
            )}
          </>
        ) : (
          <form onSubmit={signInLocal}>
            <div className="login-field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="login-field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error && <div className="acl-error">{error}</div>}

            <button
              type="submit"
              className="btn-primary"
              style={{ width: '100%', marginTop: 6 }}
              disabled={submitting}
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>

            {oauthMethods.length > 0 && (
              <button type="button" className="login-back" onClick={() => setMode('choose')}>
                ← Other sign-in options
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
