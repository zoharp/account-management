/**
 * Session tokens and the platform-staff gate.
 *
 * Port of `backend/sessions.py` + `get_current_user` / `require_orcanos_admin`
 * from `backend/auth.py`. The token is the SAME HS256 JWT the QMS backend
 * issues — same claims, same 24h expiry, same `iss` — so when both apps share
 * a JWT_SECRET a session from one is accepted by the other.
 *
 * Storage differs deliberately: QMS keeps the token in `localStorage`, this app
 * keeps it in an httpOnly, SameSite=Lax cookie. The token format is unchanged;
 * only where the browser puts it. httpOnly means a XSS bug in this control
 * plane cannot exfiltrate a token that administers every tenant.
 */

import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { jwtSecret, platformEmailDomain } from './env';
import { pgGet } from './supabase';
import type { PlatformUser } from './types';

export const SESSION_COOKIE = 'session_token';
const TOKEN_EXPIRE_HOURS = 24;
const ISSUER = 'orcanos-qms';

function secretKey(): Uint8Array {
  return new TextEncoder().encode(jwtSecret());
}

export interface SessionClaims {
  sub: string;
  email: string;
  name: string;
  account: string;
  auth_method: string;
}

/** Port of `create_session_token()`. Claim names and order match exactly. */
export async function createSessionToken(
  userId: number | string,
  email: string,
  displayName: string,
  accountName: string,
  authMethod: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    email,
    name: displayName,
    account: accountName,
    auth_method: authMethod,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setIssuedAt(now)
    .setExpirationTime(now + TOKEN_EXPIRE_HOURS * 3600)
    .setIssuer(ISSUER)
    .sign(secretKey());
}

/** Port of `verify_session_token()` — returns null on expired/invalid. */
export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    if (!payload.sub) return null;
    return {
      sub: String(payload.sub),
      email: String(payload.email ?? ''),
      name: String(payload.name ?? ''),
      account: String(payload.account ?? ''),
      auth_method: String(payload.auth_method ?? ''),
    };
  } catch {
    return null;
  }
}

/**
 * Resolve the caller to a row in the master `users` table.
 *
 * Mirrors `get_current_user`: the JWT is only a pointer — `role` and `email`
 * always come from the database, never from the claims, so revoking an admin
 * in the DB takes effect immediately instead of at token expiry.
 *
 * The legacy Supabase-Auth fallback path in the QMS backend is deliberately NOT
 * ported: platform staff sign in through `auth_methods`, and carrying a second
 * accepted token format into a control plane widens the attack surface for no
 * benefit. A staff member holding only a legacy Supabase token signs in again.
 */
export async function getCurrentUser(): Promise<PlatformUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const claims = await verifySessionToken(token);
  if (!claims) return null;

  const rows = await pgGet<PlatformUser[]>(
    `users?id=eq.${encodeURIComponent(claims.sub)}&select=id,email,display_name,role,auth_method,last_login_at`,
  );
  return rows[0] ?? null;
}

/**
 * The platform-staff predicate. Identical to `require_orcanos_admin`:
 * an `@orcanos.com` address AND role='admin'.
 */
export function isPlatformStaff(user: PlatformUser | null): boolean {
  if (!user) return false;
  const domain = platformEmailDomain().toLowerCase();
  return (
    user.role === 'admin' && (user.email ?? '').toLowerCase().endsWith(`@${domain}`)
  );
}

/**
 * Route-handler guard. Returns the user, or a Response to return as-is.
 *
 * Answers **404**, not 403, exactly as `require_orcanos_admin` does — a
 * non-staff caller cannot tell these routes exist. Keep it that way.
 */
export async function requirePlatformStaff(): Promise<
  { user: PlatformUser; error: null } | { user: null; error: Response }
> {
  const user = await getCurrentUser();
  if (!isPlatformStaff(user)) {
    return {
      user: null,
      error: Response.json({ detail: 'Not found' }, { status: 404 }),
    };
  }
  return { user: user as PlatformUser, error: null };
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: TOKEN_EXPIRE_HOURS * 3600,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
