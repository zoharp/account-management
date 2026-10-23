/**
 * GET  /api/staff — everyone on the staff email domain, with whether they can sign in.
 * POST /api/staff — add a person (or re-admit an existing `users` row with that email).
 *
 * See `lib/staff.ts`. Being an Orcanos admin is still required at sign-in (`Is_admin`,
 * checked by `api/auth/local/login`); this only supplies the master row the gate needs.
 */

import { requirePlatformStaff } from '@/lib/session';
import { isStaffEmail, listStaff, staffDomain, upsertStaff, usernameTakenBy } from '@/lib/staff';
import { logSecurityEvent } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const USERNAME_RE = /^[A-Za-z0-9._@-]{1,100}$/;

export async function GET() {
  const { user, error } = await requirePlatformStaff();
  if (error) return error;
  try {
    return Response.json({ staff: await listStaff(), domain: staffDomain(), me: user.id });
  } catch (e) {
    return Response.json({ detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const { user, error } = await requirePlatformStaff();
  if (error) return error;
  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    display_name?: string;
    orcanos_user_name?: string;
  };
  const email = (body.email ?? '').trim().toLowerCase();
  const username = (body.orcanos_user_name ?? '').trim();
  const displayName = (body.display_name ?? '').trim().slice(0, 200);

  if (!isStaffEmail(email) || !/^[^\s@]+@[^\s@]+$/.test(email)) {
    return Response.json({ detail: `The email must be an @${staffDomain()} address.` }, { status: 400 });
  }
  if (!USERNAME_RE.test(username)) {
    return Response.json(
      { detail: 'Enter their Orcanos username exactly as they sign in to Orcanos with it.' },
      { status: 400 },
    );
  }

  try {
    const taken = await usernameTakenBy(username);
    if (taken && taken.email.toLowerCase() !== email) {
      return Response.json(
        { detail: `The Orcanos username "${username}" is already set on ${taken.email}.` },
        { status: 409 },
      );
    }
    const { row, created, before } = await upsertStaff({
      email,
      display_name: displayName,
      orcanos_user_name: username,
    });
    await logSecurityEvent('staff_added', {
      user,
      detail: {
        staff_id: row.id,
        email: row.email,
        orcanos_user_name: row.orcanos_user_name,
        created,
        ...(before ? { previous_role: before.role, previous_orcanos_user_name: before.orcanos_user_name } : {}),
      },
    });
    return Response.json({ staff: row, created });
  } catch (e) {
    return Response.json({ detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
