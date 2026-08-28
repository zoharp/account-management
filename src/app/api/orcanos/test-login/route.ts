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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: Request) {
  const { error } = await requirePlatformStaff();
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

  const result = await orcanosTestLogin({
    apiUrl: body.api_url ?? '',
    username: body.username ?? '',
    password: body.password,
    account,
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
