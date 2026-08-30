/**
 * POST /api/auth/local/login — email *or* Orcanos user name, plus password.
 *
 * Orcanos-backed, per CLAUDE.md "Planned: Orcanos sign-in" (now built). The
 * password is verified against the platform account's own Orcanos tenant via
 * `QW_Login`, not bcrypt against `users.password_hash` — that column and
 * `local_enabled` stay in the schema because QMS still uses both, but this
 * route no longer reads either.
 *
 * The first field still identifies the *person* (a master `users` row, created
 * deliberately by an admin — no auto-provisioning); it may be that row's
 * `email` or its `orcanos_user_name`, because people know themselves by the
 * Orcanos username they already sign in with. Either way both columns are
 * admin-set, so accepting both widens only what a known person may type. What
 * QW_Login itself supplies is the *tenant* — `Virtual_dir` — which is checked
 * against the sign-in URL's tenant segment and, on this row's first successful
 * login, recorded into `orcanos_account`.
 *
 * ⚠️ Since 0.2.7 that URL may come from the request (`orcanosUrl`), so the
 * tenant check is no longer a security boundary — read the long comment on the
 * URL resolution block below, and SECURITY.md §9.2.
 *
 * Signup, forgot-password and reset-password are deliberately NOT ported —
 * see README "Known deltas". Platform staff accounts are created by an
 * existing admin, and password resets go through Orcanos itself now.
 */

import { orcanosLoginHostAllowlist, orcanosLoginUrl, platformAccount } from '@/lib/env';
import { accountCiFilter, pgGet } from '@/lib/supabase';
import {
  getAuthMethodsConfig,
  findUserByEmailOrOrcanosUserName,
  findUserByOrcanosIdentity,
  linkOrcanosAccount,
} from '@/lib/users';
import { qwLoginIdentity } from '@/lib/orcanos';
import { normalizeOrcanosUrl, orcanosVirtualDirFromUrl } from '@/lib/orcanos-url';
import { completeLogin } from '@/lib/login';
import { logSecurityEvent } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const account = platformAccount();
  // `identifier` is the current field name; `email` is still accepted so an
  // older client (or a saved request) keeps working.
  const body = (await req.json().catch(() => ({}))) as {
    identifier?: string;
    email?: string;
    password?: string;
    /** The Orcanos server to check against. Client-supplied — see below. */
    orcanosUrl?: string;
  };
  const identifier = (body.identifier ?? body.email ?? '').trim();
  if (!identifier || !body.password) {
    return Response.json(
      { detail: 'Email or username and password are required' },
      { status: 400 },
    );
  }

  const config = await getAuthMethodsConfig(account);
  if (!config?.local_enabled) {
    return Response.json({ detail: 'Local auth not enabled for this account' }, { status: 403 });
  }

  // ── Which Orcanos server this sign-in is checked against ────────────────
  //
  // ⚠️ CLIENT-SUPPLIED BY DESIGN since 0.2.7, at the user's explicit request
  // after the risk was put to them. Read SECURITY.md §9.2 before touching this.
  //
  // What it costs: the tenant pin below no longer constrains anything an
  // attacker controls, because the SAME string now supplies both the server
  // that is asked and the `Virtual_dir` that server is expected to report.
  // Anyone who can reach this route may point it at a host of their own that
  // answers `IsSuccess` with `Is_admin=1` and any `Virtual_dir`, and thereby
  // sign in as any master `users` row whose email or `orcanos_user_name` they
  // can name — without ever knowing that person's password. Requiring
  // Orcanos `Is_admin` is no longer a control at all; it is an assertion by a
  // server the caller chose.
  //
  // What is left standing: the SSRF guard in `qwLoginIdentity`, the optional
  // `ORCANOS_LOGIN_HOST_ALLOWLIST` (off by default — set it to `orcanos.com`
  // and the hole closes), and `isPlatformStaff()` in `completeLogin()`, which
  // re-reads `role` and `email` from master on every request.
  //
  // Resolution order: what was typed → the platform account's own stored
  // `orcanos_api_url` → `ORCANOS_LOGIN_URL` (default `app.orcanos.com/orcanos`).
  const accountRows = await pgGet<Array<{ orcanos_api_url: string | null }>>(
    `accounts?account_name=${accountCiFilter(account)}&select=orcanos_api_url`,
  );
  const requestedUrl = (body.orcanosUrl ?? '').trim();
  const apiUrl = normalizeOrcanosUrl(
    requestedUrl || accountRows[0]?.orcanos_api_url || orcanosLoginUrl(),
  );

  // Host restriction, applied only to a URL that arrived on the request — a URL
  // from the database or the environment is server-side already.
  const allowlist = orcanosLoginHostAllowlist();
  if (requestedUrl && allowlist.length) {
    let host = '';
    try {
      host = new URL(apiUrl).hostname.toLowerCase();
    } catch {
      host = '';
    }
    const allowed = host !== '' && allowlist.some((h) => host === h || host.endsWith(`.${h}`));
    if (!allowed) {
      await logSecurityEvent('login_denied', {
        accountName: account,
        detail: { identifier, reason: 'orcanos_host_not_allowed', orcanos_url: apiUrl },
        success: false,
      });
      return Response.json(
        { detail: 'That Orcanos server is not permitted for sign-in.' },
        { status: 403 },
      );
    }
  }

  // The tenant segment of whatever URL we ended up with (e.g. `orcanosdemo` in
  // `https://app.orcanos.com/orcanosdemo/api/v2/Json`) — the value QW_Login
  // itself reports as `Virtual_dir`, and NOT the PLATFORM_ACCOUNT label, which
  // is only the master-DB config-row key. Now that the URL can come from the
  // request, comparing the two catches a mistyped tenant path against a real
  // Orcanos server; it is no longer a security boundary.
  const expectedVirtualDir = orcanosVirtualDirFromUrl(apiUrl);
  if (!expectedVirtualDir) {
    return Response.json(
      {
        detail:
          'The Orcanos URL must include the tenant path — for example app.orcanos.com/orcanos.',
      },
      { status: 400 },
    );
  }

  // Resolved after the tenant is known, because the username half of the lookup
  // is scoped to it.
  const user = await findUserByEmailOrOrcanosUserName(identifier, expectedVirtualDir);
  if (!user?.orcanos_user_name) {
    // Same message and log reason whether the row is missing entirely or just
    // not yet linked to an Orcanos identity — no user enumeration.
    await logSecurityEvent('login_failed', {
      accountName: account,
      detail: { identifier, reason: 'no_such_user' },
      success: false,
    });
    return Response.json({ detail: 'Invalid credentials' }, { status: 401 });
  }

  const identity = await qwLoginIdentity(apiUrl, user.orcanos_user_name, body.password);
  if (!identity.ok) {
    await logSecurityEvent('login_failed', {
      user,
      accountName: account,
      detail: { reason: 'orcanos_rejected', error: identity.error, orcanos_url: apiUrl },
      success: false,
    });
    return Response.json({ detail: 'Invalid credentials' }, { status: 401 });
  }

  // Was pinned server-side before 0.2.7; now both sides of this comparison
  // derive from the same request-supplied URL, so it catches a wrong tenant
  // path and nothing more. See the block above and SECURITY.md §9.2.
  if (identity.virtualDir !== expectedVirtualDir) {
    await logSecurityEvent('login_denied', {
      user,
      accountName: account,
      detail: {
        reason: 'wrong_orcanos_tenant',
        virtual_dir: identity.virtualDir,
        expected: expectedVirtualDir,
        orcanos_url: apiUrl,
      },
      success: false,
    });
    return Response.json({ detail: 'Invalid credentials' }, { status: 401 });
  }

  if (!identity.isAdmin) {
    await logSecurityEvent('login_denied', {
      user,
      accountName: account,
      detail: { reason: 'orcanos_not_admin', orcanos_url: apiUrl },
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

  return completeLogin(
    user.email,
    identity.displayName || user.display_name || '',
    'orcanos',
    account,
    { orcanos_url: apiUrl, virtual_dir: identity.virtualDir, client_supplied_url: !!requestedUrl },
  );
}
