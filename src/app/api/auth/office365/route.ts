/**
 * POST /api/auth/office365 — exchange a Microsoft Entra authorization code.
 * Ports `handle_office365_oauth` + `POST /auth/office365`.
 */

import { appOrigin, platformAccount } from '@/lib/env';
import { getAuthMethodsConfig } from '@/lib/users';
import { completeLogin } from '@/lib/login';
import { logSecurityEvent } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TOKEN_URL = (tenant: string) =>
  `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
const USERINFO_URL = 'https://graph.microsoft.com/v1.0/me';

export async function POST(req: Request) {
  const account = platformAccount();
  const body = (await req.json().catch(() => ({}))) as { code?: string; redirect_uri?: string };
  if (!body.code) return Response.json({ detail: 'Missing: code' }, { status: 400 });

  const redirectUri = body.redirect_uri || `${appOrigin(req)}/auth/callback`;

  try {
    const config = await getAuthMethodsConfig(account);
    if (!config?.office365_enabled) throw new Error('Office 365 auth not enabled for this account');

    const tenant = config.office365_tenant || 'common';
    const tokenRes = await fetch(TOKEN_URL(tenant), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: body.code,
        client_id: config.office365_client_id ?? '',
        client_secret: config.office365_secret ?? '',
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        scope: 'openid profile email',
      }),
      cache: 'no-store',
    });
    if (!tokenRes.ok) {
      throw new Error(`Token exchange failed: ${(await tokenRes.text()).slice(0, 200)}`);
    }
    const accessToken = ((await tokenRes.json()) as { access_token: string }).access_token;

    const userRes = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (!userRes.ok) throw new Error('Could not read Microsoft profile');
    const profile = (await userRes.json()) as {
      userPrincipalName: string;
      displayName?: string;
      mail?: string;
    };

    const email = profile.mail || profile.userPrincipalName;
    return await completeLogin(email, profile.displayName || email, 'office365', account);
  } catch (e) {
    await logSecurityEvent('login_failed', {
      accountName: account,
      detail: { method: 'office365', error: String(e).slice(0, 300) },
      success: false,
    });
    return Response.json({ detail: e instanceof Error ? e.message : String(e) }, { status: 401 });
  }
}
