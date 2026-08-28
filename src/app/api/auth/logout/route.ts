/** POST /api/auth/logout — clear the session cookie. */

import { clearSessionCookie, getCurrentUser } from '@/lib/session';
import { logSecurityEvent } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const user = await getCurrentUser();
  await clearSessionCookie();
  if (user) {
    await logSecurityEvent('logout', { user, detail: { app: 'account-management' } });
  }
  return Response.json({ success: true });
}
