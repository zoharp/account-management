/**
 * POST /api/auth/google — exchange a Google authorization code for a session.
 *
 * Ports `handle_google_oauth` (backend/oauth_handlers.py) + `POST /auth/google`
 * (backend/api.py). The client_id and client_secret come from the platform
 * account's `auth_methods` row, exactly as they do in QMS, so the same Google
 * OAuth app serves both — only the redirect_uri differs, and that origin has to
 * be added to the Google client's authorised redirect URIs (see README).
 *
 * The gate and the no-auto-provisioning rule live in `completeLogin`.
 */

import { appOrigin, platformAccount } from '@/lib/env';
import { getAuthMethodsConfig } from '@/lib/users';
import { completeLogin } from '@/lib/login';
import { logSecurityEvent } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export async function POST(req: Request) {
  const account = platformAccount();
  const body = (await req.json().catch(() => ({}))) as { code?: string; redirect_uri?: string };
  if (!body.code) return Response.json({ detail: 'Missing: code' }, { status: 400 });

  // Must be byte-identical to the redirect_uri used in the authorize step.
  const redirectUri = body.redirect_uri || `${appOrigin(req)}/auth/callback`;

  try {
    const config = await getAuthMethodsConfig(account);
    if (!config?.google_enabled) throw new Error('Google auth not enabled for this account');

    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: body.code,
        client_id: config.google_client_id ?? '',
        client_secret: config.google_secret ?? '',
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
      cache: 'no-store',
    });
    if (!tokenRes.ok) {
      throw new Error(`Token exchange failed: ${(await tokenRes.text()).slice(0, 200)}`);
    }
    const accessToken = ((await tokenRes.json()) as { access_token: string }).access_token;

    const userRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (!userRes.ok) throw new Error('Could not read Google profile');
    const profile = (await userRes.json()) as { email: string; name?: string };

    return await completeLogin(profile.email, profile.name || profile.email, 'google', account);
  } catch (e) {
    await logSecurityEvent('login_failed', {
      accountName: account,
      detail: { method: 'google', error: String(e).slice(0, 300) },
      success: false,
    });
    return Response.json({ detail: e instanceof Error ? e.message : String(e) }, { status: 401 });
  }
}
