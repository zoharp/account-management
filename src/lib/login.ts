/**
 * The shared tail of every successful sign-in: resolve the identity to a master
 * `users` row, enforce the platform-staff gate, issue the session cookie.
 *
 * Kept out of the route files because a Next.js `route.ts` may only export HTTP
 * method handlers and route config — anything else fails the build.
 */

import { platformEmailDomain } from './env';
import { findUserByEmail, touchUser } from './users';
import { createSessionToken, isPlatformStaff, setSessionCookie } from './session';
import { logSecurityEvent } from './audit';

export async function completeLogin(
  email: string,
  displayName: string,
  method: string,
  account: string,
): Promise<Response> {
  const existing = await findUserByEmail(email);

  // No auto-provisioning. QMS creates a users row for any identity that
  // completes OAuth; a console that administers every tenant must not. Staff
  // are added deliberately by an existing admin.
  if (!existing) {
    await logSecurityEvent('login_failed', {
      accountName: account,
      detail: { method, email, reason: 'no_such_user' },
      success: false,
    });
    return Response.json(
      { detail: 'This account is not registered for the platform console.' },
      { status: 403 },
    );
  }

  if (!isPlatformStaff(existing)) {
    await logSecurityEvent('login_denied', {
      user: existing,
      accountName: account,
      detail: { method, reason: 'not_platform_staff' },
      success: false,
    });
    return Response.json(
      { detail: `Platform console access requires an @${platformEmailDomain()} administrator account.` },
      { status: 403 },
    );
  }

  const user = await touchUser(existing, displayName);
  const token = await createSessionToken(
    user.id,
    user.email,
    user.display_name ?? '',
    account,
    method,
  );
  await setSessionCookie(token);
  await logSecurityEvent('login_succeeded', {
    user,
    accountName: account,
    detail: { method, app: 'account-management' },
  });

  return Response.json({
    user: {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      auth_method: method,
    },
  });
}
