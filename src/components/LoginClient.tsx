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
/** Remembers the last Orcanos server used on this browser. Not a credential. */
const ORCANOS_URL_KEY = 'orcanos_login_url';

export default function LoginClient() {
  const router = useRouter();
  const [methods, setMethods] = useState<AuthMethodOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState('');
  const [mode, setMode] = useState<'choose' | 'local'>('choose');

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  // The Orcanos server the password is checked against. Free text, at the
  // user's explicit request (0.2.7) — the security consequence is documented in
  // SECURITY.md §9.2 and in the route itself, not here. Pre-filled from
  // `/api/auth/config`, then from whatever was used last on this browser.
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
        // localStorage wins so someone who signs in against a non-default
        // tenant does not retype it every time; the server default is the
        // fallback, and an empty box just means "use the server's".
        let remembered = '';
        try {
          remembered = localStorage.getItem(ORCANOS_URL_KEY) ?? '';
        } catch {
          // Private mode / blocked storage — fall through to the default.
        }
        setOrcanosUrl(remembered || data.default_orcanos_url || '');
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
      try {
        localStorage.setItem(ORCANOS_URL_KEY, orcanosUrl.trim());
      } catch {
        // Nothing to do — remembering the server is a convenience, not state.
      }
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
              {/* The scheme and the /api/v2/Json suffix are added server-side by
                  normalizeOrcanosUrl, so `app.orcanos.com/orcanos` is enough —
                  but the tenant path is not optional. */}
              <input
                id="orcanos-url"
                type="text"
                autoComplete="url"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="app.orcanos.com/orcanos"
                value={orcanosUrl}
                onChange={(e) => setOrcanosUrl(e.target.value)}
              />
              <p className="login-hint">
                The Orcanos server your credentials are checked against. Include the tenant
                path. Leave blank to use this deployment&rsquo;s configured server.
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
