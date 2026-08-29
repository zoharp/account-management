/**
 * POST /api/orcanos/test-login — the "Test API" button.
 *
 * Replaces the QMS `POST /orcanos/proxy/login`, narrowed to the one job this
 * app needs: check that a set of Orcanos REST credentials works and report how
 * many projects they can see. It is not a general-purpose proxy, so the
 * account-member logic and the ContextVars fallback are not carried over —
 * every caller here is already platform staff.
 *
 * Two behaviours ARE carried over, both security-relevant:
 *   - the SSRF guard on the target URL (`isSafeExternalUrl`);
 *   - when no password is typed, the stored credential is used AND the URL is
 *     pinned to the account's own stored `orcanos_api_url`, so a decrypted
 *     saved password can never be sent to a client-chosen host.
 */

import { requirePlatformStaff } from '@/lib/session';
import { pgGet } from '@/lib/supabase';
import { orcanosTestLogin } from '@/lib/orcanos';
import { logSecurityEvent } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: Request) {
  const { user, error } = await requirePlatformStaff();
  if (error) return error;

  const body = (await req.json().catch(() => ({}))) as {
    api_url?: string;
    username?: string;
    password?: string;
    account_id?: string;
  };

  // Only loaded when we need the saved credential — the create form has no
  // account yet and always supplies a password explicitly.
  let account: Record<string, unknown> | null = null;
  if (!body.password && body.account_id) {
    const rows = await pgGet<Array<Record<string, unknown>>>(
      `accounts?id=eq.${encodeURIComponent(body.account_id)}` +
        `&select=orcanos_api_url,orcanos_username,orcanos_password_encrypted`,
    );
    account = rows[0] ?? null;
  }

  const usedStoredCredential = !body.password && Boolean(account);

  const result = await orcanosTestLogin({
    apiUrl: body.api_url ?? '',
    username: body.username ?? '',
    password: body.password,
    account,
  });

  // A test that falls back to the saved credential DECRYPTS and USES a stored
  // password. That is a secret-access event and belongs in the trail whether it
  // succeeded or not — a run of failures here is what a compromised or expired
  // credential looks like from the outside. `success` carries the outcome, so a
  // failed test is a recorded event rather than an absent one.
  await logSecurityEvent('orcanos_login_tested', {
    user,
    detail: {
      account_id: body.account_id ?? null,
      used_stored_credential: usedStoredCredential,
      // The URL is pinned to the account's own when the stored password is
      // used, so recording it shows which host the secret actually reached.
      api_url: usedStoredCredential ? (account?.orcanos_api_url ?? null) : (body.api_url ?? null),
      error: result.ok ? undefined : result.error,
    },
    success: result.ok,
  });

  if (!result.ok) {
    return Response.json({ success: false, error: result.error }, { status: 200 });
  }

  const n = result.projectCount;
  return Response.json({
    success: true,
    message: `Connected — ${n} project${n !== 1 ? 's' : ''} found`,
    projects_count: n,
  });
}
