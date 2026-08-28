/**
 * POST /api/auth/local/login — email + password.
 * Port of `POST /auth/local/login`, verifying the same bcrypt hashes written by
 * the QMS backend's `hash_password` (bcrypt, cost 12).
 *
 * Signup, forgot-password and reset-password are deliberately NOT ported —
 * see README "Known deltas". Platform staff accounts are created by an existing
 * admin, and password resets still go through the QMS app, which owns the
 * outbound email service.
 */

import bcrypt from 'bcryptjs';
import { platformAccount } from '@/lib/env';
import { getAuthMethodsConfig, findUserByEmail } from '@/lib/users';
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
  if (!user?.password_hash) {
    await logSecurityEvent('login_failed', {
      accountName: account,
      detail: { email: body.email, reason: 'no_such_user' },
      success: false,
    });
    // Same message for both failure modes — no user enumeration.
    return Response.json({ detail: 'Invalid credentials' }, { status: 401 });
  }

  const ok = await bcrypt.compare(body.password, user.password_hash);
  if (!ok) {
    await logSecurityEvent('login_failed', {
      user,
      accountName: account,
      detail: { reason: 'bad_password' },
      success: false,
    });
    return Response.json({ detail: 'Invalid credentials' }, { status: 401 });
  }

  return completeLogin(user.email, user.display_name ?? '', 'local', account);
}
