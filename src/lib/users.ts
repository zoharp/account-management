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
