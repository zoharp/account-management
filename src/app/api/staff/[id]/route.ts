/**
 * PATCH  /api/staff/:id — change the Orcanos username / display name, or re-admit (role admin).
 * DELETE /api/staff/:id — remove console access: `role = 'user'`. The row is kept (shared
 *                         with QMS, keyed by email); see `lib/staff.ts`.
 *
 * Nobody can remove themselves — the last admin doing that locks everyone out, and the only
 * way back is the SQL editor.
 */

import { requirePlatformStaff } from '@/lib/session';
import { getStaff, isStaffEmail, updateStaff, usernameTakenBy } from '@/lib/staff';
import { logSecurityEvent } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const USERNAME_RE = /^[A-Za-z0-9._@-]{1,100}$/;

async function load(ctx: Ctx) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = await getStaff(id);
  // Only rows on the staff domain are this screen's business.
  return row && isStaffEmail(row.email ?? '') ? row : null;
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { user, error } = await requirePlatformStaff();
  if (error) return error;
  try {
    const before = await load(ctx);
    if (!before) return Response.json({ detail: 'Not found' }, { status: 404 });
    const body = (await req.json().catch(() => ({}))) as {
      orcanos_user_name?: string;
      display_name?: string;
      role?: string;
    };
    const fields: { orcanos_user_name?: string; display_name?: string; role?: 'admin' } = {};
    if (body.orcanos_user_name !== undefined) {
      const username = body.orcanos_user_name.trim();
      if (!USERNAME_RE.test(username)) {
        return Response.json({ detail: 'Enter their Orcanos username exactly.' }, { status: 400 });
      }
      const taken = await usernameTakenBy(username, before.id);
      if (taken) {
        return Response.json(
          { detail: `The Orcanos username "${username}" is already set on ${taken.email}.` },
          { status: 409 },
        );
      }
      fields.orcanos_user_name = username;
    }
    if (body.display_name !== undefined) fields.display_name = body.display_name.trim().slice(0, 200);
    if (body.role === 'admin') fields.role = 'admin';
    if (!Object.keys(fields).length) return Response.json({ detail: 'Nothing to change.' }, { status: 400 });

    const row = await updateStaff(before, fields);
    await logSecurityEvent('staff_updated', {
      user,
      detail: {
        staff_id: row.id,
        email: row.email,
        changed: Object.keys(fields),
        before: { role: before.role, orcanos_user_name: before.orcanos_user_name },
        after: { role: row.role, orcanos_user_name: row.orcanos_user_name },
      },
    });
    return Response.json({ staff: row });
  } catch (e) {
    return Response.json({ detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { user, error } = await requirePlatformStaff();
  if (error) return error;
  try {
    const before = await load(ctx);
    if (!before) return Response.json({ detail: 'Not found' }, { status: 404 });
    if (before.id === user.id) {
      return Response.json({ detail: 'You cannot remove your own access.' }, { status: 400 });
    }
    const row = await updateStaff(before, { role: 'user' });
    await logSecurityEvent('staff_removed', {
      user,
      detail: { staff_id: row.id, email: row.email, previous_role: before.role },
    });
    return Response.json({ staff: row });
  } catch (e) {
    return Response.json({ detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
