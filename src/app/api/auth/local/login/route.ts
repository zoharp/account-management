/**
 * POST /api/auth/local/login — email + password.
 *
 * Orcanos-backed, per CLAUDE.md "Planned: Orcanos sign-in" (now built). The
 * password is verified against the platform account's own Orcanos tenant via
 * `QW_Login`, not bcrypt against `users.password_hash` — that column and
 * `local_enabled` stay in the schema because QMS still uses both, but this
 * route no longer reads either.
 *
 * The email field still identifies the *person* (a master `users` row,
 * created deliberately by an admin — no auto-provisioning). The Orcanos
 * username that row authenticates with (`users.orcanos_user_name`) is set by
 * an admin the same way, ahead of time. What QW_Login itself supplies is the
 * *tenant* — `Virtual_dir` — which is pinned against `PLATFORM_ACCOUNT` and,
 * on this row's first successful login, recorded into `orcanos_account`.
 *
 * Signup, forgot-password and reset-password are deliberately NOT ported —
 * see README "Known deltas". Platform staff accounts are created by an
 * existing admin, and password resets go through Orcanos itself now.
 */

import { platformAccount } from '@/lib/env';
import { accountCiFilter, pgGet } from '@/lib/supabase';
import { getAuthMethodsConfig, findUserByEmail, findUserByOrcanosIdentity, linkOrcanosAccount } from '@/lib/users';
import { qwLoginIdentity } from '@/lib/orcanos';
import { orcanosVirtualDirFromUrl } from '@/lib/orcanos-url';
import { completeLogin } from '@/lib/login';
import { logSecurityEvent } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const account = platformAccount();
  const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  if (!body.email || !body.password) {
    return Response.json({ detail: 'Email and password are required' }, { status: 400 });
  }

  const config = await getAuthMethodsConfig(account);
  if (!config?.local_enabled) {
    return Response.json({ detail: 'Local auth not enabled for this account' }, { status: 403 });
  }

  const user = await findUserByEmail(body.email);
  if (!user?.orcanos_user_name) {
    // Same message and log reason whether the row is missing entirely or just
    // not yet linked to an Orcanos identity — no user enumeration.
    await logSecurityEvent('login_failed', {
      accountName: account,
      detail: { email: body.email, reason: 'no_such_user' },
      success: false,
    });
    return Response.json({ detail: 'Invalid credentials' }, { status: 401 });
  }

  const accountRows = await pgGet<Array<{ orcanos_api_url: string | null }>>(
    `accounts?account_name=${accountCiFilter(account)}&select=orcanos_api_url`,
  );
  const apiUrl = accountRows[0]?.orcanos_api_url;
  if (!apiUrl) {
    return Response.json(
      { detail: `Platform account '${account}' has no orcanos_api_url configured.` },
      { status: 500 },
    );
  }

  // The pin target: NOT the PLATFORM_ACCOUNT label itself (that is only the
  // master-DB config-row key, e.g. 'demo') but the tenant segment of that
  // account's own orcanos_api_url (e.g. 'orcanosdemo') — the value QW_Login
  // itself reports as Virtual_dir. Server-side, derived from a column no
  // client ever supplies.
  const expectedVirtualDir = orcanosVirtualDirFromUrl(apiUrl);
  if (!expectedVirtualDir) {
    return Response.json(
      { detail: `Platform account '${account}' has an unparseable orcanos_api_url.` },
      { status: 500 },
    );
  }

  const identity = await qwLoginIdentity(apiUrl, user.orcanos_user_name, body.password);
  if (!identity.ok) {
    await logSecurityEvent('login_failed', {
      user,
      accountName: account,
      detail: { reason: 'orcanos_rejected', error: identity.error },
      success: false,
    });
    return Response.json({ detail: 'Invalid credentials' }, { status: 401 });
  }

  // Pinned server-side, never client-supplied: this console only ever signs
  // people into the ONE Orcanos tenant it is configured for. Without this
  // check, requiring Is_admin below would let any customer's own Orcanos
  // administrator into the control plane.
  if (identity.virtualDir !== expectedVirtualDir) {
    await logSecurityEvent('login_denied', {
      user,
      accountName: account,
      detail: { reason: 'wrong_orcanos_tenant', virtual_dir: identity.virtualDir, expected: expectedVirtualDir },
      success: false,
    });
    return Response.json({ detail: 'Invalid credentials' }, { status: 401 });
  }

  if (!identity.isAdmin) {
    await logSecurityEvent('login_denied', {
      user,
      accountName: account,
      detail: { reason: 'orcanos_not_admin' },
      success: false,
    });
    return Response.json({ detail: 'Invalid credentials' }, { status: 401 });
  }

  if (user.orcanos_account) {
    if (user.orcanos_account !== identity.virtualDir) {
      await logSecurityEvent('login_denied', {
        user,
        accountName: account,
        detail: { reason: 'orcanos_identity_mismatch' },
        success: false,
      });
      return Response.json({ detail: 'Invalid credentials' }, { status: 401 });
    }
  } else {
    // First successful QW_Login for this row: bind it to the tenant, unless
    // that (account, username) pair is already claimed by a different row.
    const conflict = await findUserByOrcanosIdentity(identity.virtualDir!, user.orcanos_user_name);
    if (conflict && conflict.id !== user.id) {
      await logSecurityEvent('login_denied', {
        user,
        accountName: account,
        detail: { reason: 'orcanos_identity_already_linked' },
        success: false,
      });
      return Response.json({ detail: 'Invalid credentials' }, { status: 401 });
    }
    await linkOrcanosAccount(user.id, identity.virtualDir!);
  }

  return completeLogin(user.email, identity.displayName || user.display_name || '', 'orcanos', account);
}
