'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AuthMethodOption } from '@/lib/types';
import OrcanosLogo from './OrcanosLogo';

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

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  // The Orcanos server the password is checked against. Shown, but no longer
  // editable: it is whatever `/api/auth/config` reports as this deployment's
  // configured server, and the box is disabled. It is still sent on the
  // request, so the tenant the login runs against stays the one on screen
  // rather than the platform account's own stored URL — those differ today
  // (`orcanos` vs `orcanosdemo`), and the server's fallback order would pick
  // the wrong one. The route still applies `ORCANOS_LOGIN_HOST_ALLOWLIST` to
  // anything client-supplied; see SECURITY.md §9.2.
  const [orcanosUrl, setOrcanosUrl] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/config', { cache: 'no-store' });
        const data = (await res.json()) as {
          methods?: AuthMethodOption[];
          default_orcanos_url?: string;
          detail?: string;
        };
        if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
        setMethods(data.methods ?? []);
        // The one source now the box is read-only. A remembered value used to
        // win here; with nothing to edit that would pin a stale server on this
        // browser forever, so it is gone.
        setOrcanosUrl(data.default_orcanos_url || '');
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
      // No `access_type=offline` and no `prompt`: the code is exchanged once for
      // the profile and the refresh token is never used, so asking for offline
      // access only forces Google's consent screen on every sign-in. Without
      // either, an already-signed-in browser lands straight back on /auth/callback.
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
        body: JSON.stringify({ identifier, password, orcanosUrl: orcanosUrl.trim() }),
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
        <div className="login-brand-row">
          <OrcanosLogo />
          <div>
            <h1 className="login-title">Orcanos Platform</h1>
            <p className="login-sub">Console sign-in</p>
          </div>
        </div>

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
                Sign in with Orcanos credentials
              </button>
            )}
          </>
        ) : (
          <form onSubmit={signInLocal}>
            <div className="login-field">
              <label htmlFor="orcanos-url">Orcanos URL</label>
              {/* Fixed by the deployment (`ORCANOS_LOGIN_URL`, via /api/auth/config)
                  and shown only so the person knows which server their password
                  is about to be checked against. The scheme and the /api/v2/Json
                  suffix are added server-side by normalizeOrcanosUrl, so
                  `app.orcanos.com/orcanos` is the whole value — tenant path
                  included, which is not optional. */}
              <input
                id="orcanos-url"
                type="text"
                autoComplete="url"
                autoCapitalize="none"
                spellCheck={false}
                value={orcanosUrl}
                disabled
                readOnly
              />
              <p className="login-hint">
                The Orcanos server your credentials are checked against. Set by this
                deployment and not changeable here.
              </p>
            </div>
            <div className="login-field">
              <label htmlFor="identifier">Email or Orcanos username</label>
              {/* Deliberately type="text": type="email" would reject a bare
                  Orcanos username before the request is even made. */}
              <input
                id="identifier"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
              />
            </div>
            <div className="login-field">
              <label htmlFor="password">Password</label>
              <div className="login-password">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="login-password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  tabIndex={-1}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
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
