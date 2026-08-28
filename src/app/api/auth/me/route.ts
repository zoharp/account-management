/**
 * GET /api/auth/me — who is signed in.
 * Equivalent to the QMS `GET /users/me`, but additionally reports whether the
 * caller passes the platform-staff gate, which is what the UI keys off.
 */

import { getCurrentUser, isPlatformStaff } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ user: null }, { status: 401 });

  return Response.json({
    user: {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      role: user.role,
    },
    is_platform_staff: isPlatformStaff(user),
  });
}
