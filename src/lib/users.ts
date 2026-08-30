/**
 * Master-DB user and auth-method lookups.
 * Ports `_get_auth_methods_config`, `_find_user_by_email` and
 * `_create_or_update_user` from `backend/api.py`.
 */

import { accountCiFilter, pgGet, pgPatch, pgPost } from './supabase';
import type { PlatformUser } from './types';

export interface AuthMethodsConfig {
  account_name: string;
  google_enabled: boolean;
  google_client_id: string | null;
  google_secret: string | null;
  office365_enabled: boolean;
  office365_client_id: string | null;
  office365_secret: string | null;
  office365_tenant: string | null;
  local_enabled: boolean;
  password_policy: Record<string, unknown> | null;
}

export async function getAuthMethodsConfig(
  accountName: string,
): Promise<AuthMethodsConfig | null> {
  const rows = await pgGet<AuthMethodsConfig[]>(
    `auth_methods?account_name=${accountCiFilter(accountName)}&select=*`,
  );
  return rows[0] ?? null;
}

/** Full row including `password_hash` — for local login only. Never returned to a client. */
export async function findUserByEmail(
  email: string,
): Promise<(PlatformUser & { password_hash?: string | null }) | null> {
  const rows = await pgGet<Array<PlatformUser & { password_hash?: string | null }>>(
    `users?email=eq.${encodeURIComponent(email)}&select=*`,
  );
  return rows[0] ?? null;
}

/**
 * Resolve what the sign-in form's first field holds — an email address **or**
 * the person's Orcanos user name. Both are set deliberately by an admin on the
 * master `users` row; neither is self-service, so accepting either only widens
 * what a known person may type, not who may sign in.
 *
 * Email wins when a row matches on both: it is the platform's own identity and
 * the value the session is issued against.
 *
 * Two PostgREST quirks are handled here rather than in the filter — there is no
 * case-insensitive equality operator, and `ilike` treats `_` (common in
 * usernames) and `%` as wildcards. So the filter is deliberately loose and the
 * exact, case-insensitive match is re-checked in code.
 *
 * The username half is scoped to rows that are unlinked or already bound to
 * this tenant: `orcanos_user_name` is unique per `orcanos_account`, and this
 * console signs people into exactly one tenant.
 */
export async function findUserByEmailOrOrcanosUserName(
  identifier: string,
  orcanosAccount: string,
): Promise<(PlatformUser & { password_hash?: string | null }) | null> {
  const wanted = identifier.trim().toLowerCase();
  if (!wanted) return null;

  const query = (column: 'email' | 'orcanos_user_name') =>
    pgGet<Array<PlatformUser & { password_hash?: string | null }>>(
      `users?${column}=ilike.${encodeURIComponent(wanted)}&select=*&limit=50`,
    );

  const byEmail = (await query('email')).find((r) => (r.email ?? '').trim().toLowerCase() === wanted);
  if (byEmail) return byEmail;

  return (
    (await query('orcanos_user_name')).find(
      (r) =>
        (r.orcanos_user_name ?? '').trim().toLowerCase() === wanted &&
        (!r.orcanos_account || r.orcanos_account === orcanosAccount),
    ) ?? null
  );
}

/**
 * Look up a `users` row by its linked Orcanos identity — the join key QW_Login
 * itself cannot provide (it returns no email). Used only to detect a conflict
 * before linking a second row to the same `(orcanos_account, orcanos_user_name)`
 * pair; the unique index in `sql/002_orcanos_identity.sql` is the real guard.
 */
export async function findUserByOrcanosIdentity(
  orcanosAccount: string,
  orcanosUserName: string,
): Promise<PlatformUser | null> {
  const rows = await pgGet<PlatformUser[]>(
    `users?orcanos_account=eq.${encodeURIComponent(orcanosAccount)}` +
      `&orcanos_user_name=ilike.${encodeURIComponent(orcanosUserName)}&select=*`,
  );
  return rows[0] ?? null;
}

/**
 * Bind a master `users` row to the Orcanos tenant it just proved control of.
 * Called once, on the first successful `QW_Login` for that row — see
 * CLAUDE.md "Planned: Orcanos sign-in". `orcanos_user_name` is expected to
 * already be set (an admin enters it deliberately, the same way the row's
 * email is); only `orcanos_account` (the tenant / `Virtual_dir`) is filled
 * here, because that is the value QW_Login itself supplies.
 */
export async function linkOrcanosAccount(userId: number, orcanosAccount: string): Promise<void> {
  await pgPatch(`users?id=eq.${userId}`, { orcanos_account: orcanosAccount });
}

/**
 * Port of `_create_or_update_user`.
 *
 * One deliberate difference: the QMS version creates a `users` row for any
 * successful OAuth identity. This app does not auto-create — see the comment in
 * `src/app/api/auth/google/route.ts`. It only refreshes an existing row.
 */
export async function touchUser(
  user: PlatformUser,
  displayName: string,
): Promise<PlatformUser> {
  const now = new Date().toISOString();
  try {
    await pgPatch(`users?id=eq.${user.id}`, {
      display_name: displayName || user.display_name,
      last_login_at: now,
    });
  } catch {
    // A failed last_login_at update must not block a valid login.
  }
  return { ...user, display_name: displayName || user.display_name };
}

export async function createUser(fields: {
  email: string;
  display_name: string;
  auth_method: string;
  role?: string;
}): Promise<PlatformUser> {
  const rows = await pgPost<PlatformUser[]>('users', {
    email: fields.email,
    display_name: fields.display_name,
    auth_method: fields.auth_method,
    role: fields.role ?? 'user',
    last_login_at: new Date().toISOString(),
  });
  return rows[0];
}
