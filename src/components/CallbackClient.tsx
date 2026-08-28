'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * OAuth landing page. Port of `processOAuthCallback` in QMS Auth.jsx.
 *
 * Verifies the `state` this app generated before the redirect, then posts the
 * authorization code to the matching API route, which does the confidential
 * exchange (the client secret never reaches the browser) and sets the session
 * cookie.
 *
 * Unlike the QMS version, a missing or mismatched `state` is a hard failure.
 * QMS skipped the check when no local state existed, to stay compatible with
 * its legacy Supabase-OAuth path; there is no legacy path here, so the only
 * thing that skipping would buy is a CSRF hole.
 */
export default function CallbackClient() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState('');
  const ran = useRef(false);

  useEffect(() => {
    // React 18 StrictMode double-invokes effects in dev; an authorization code
    // is single-use, so the second run would always fail.
    if (ran.current) return;
    ran.current = true;

    (async () => {
      const code = params.get('code');
      const returnedState = params.get('state');
      const oauthError = params.get('error');

      if (oauthError) {
        setError(params.get('error_description') || oauthError);
        return;
      }
      if (!code) {
        setError('No authorization code in the callback URL.');
        return;
      }

      const stashed = sessionStorage.getItem('oauth_state');
      sessionStorage.removeItem('oauth_state');
      if (!stashed) {
        setError('Sign-in session expired. Start again from the sign-in page.');
        return;
      }

      const { state, provider, redirectUri } = JSON.parse(stashed) as {
        state: string;
        provider: string;
        redirectUri: string;
      };
      if (!returnedState || returnedState !== state) {
        setError('Sign-in state did not match. Start again from the sign-in page.');
        return;
      }

      try {
        const res = await fetch(`/api/auth/${provider}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, redirect_uri: redirectUri }),
        });
        const data = (await res.json().catch(() => ({}))) as { detail?: string };
        if (!res.ok) throw new Error(data.detail || `Sign-in failed (HTTP ${res.status})`);

        router.replace('/accounts');
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [params, router]);

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1 className="login-title">Orcanos Platform</h1>
        {error ? (
          <>
            <div className="acl-error" style={{ marginTop: 14 }}>
              {error}
            </div>
            <button
              className="btn-primary"
              style={{ width: '100%', marginTop: 6 }}
              onClick={() => router.replace('/login')}
            >
              Back to sign-in
            </button>
          </>
        ) : (
          <p className="login-sub" style={{ marginTop: 14 }}>
            Signing you in…
          </p>
        )}
      </div>
    </div>
  );
}
