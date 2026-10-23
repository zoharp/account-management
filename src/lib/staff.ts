/**
 * Console staff — who may sign in to this app (1.9.0, the Staff screen).
 *
 * "Staff" is not a table: it is the master `users` rows that pass the platform gate
 * (`role = 'admin'` and an `@PLATFORM_EMAIL_DOMAIN` email), plus, for Orcanos sign-in, an
 * `orcanos_user_name` — the stored name `QW_Login` is called with. Before this screen all
 * three were set by hand in the SQL editor, and someone who was only an Orcanos admin got
 * `Invalid credentials` (`no_such_user`).
 *
 * `users` is shared with QMS and keyed by email, so this module never deletes a row:
 * removing someone sets `role = 'user'`, which is the gate's instant kill switch here and
 * in QMS (`require_orcanos_admin` is the same check). The row, its history and anything
 * QMS hangs off it stay.
 */

import { platformEmailDomain } from './env';
import { pgGet, pgPatch, pgPost } from './supabase';

export interface StaffRow {
  id: number;
  email: string;
  display_name: string | null;
  role: string;
  orcanos_user_name: string | null;
  orcanos_account: string | null;
  last_login_at: string | null;
  created_at: string | null;
}

const COLUMNS = 'id,email,display_name,role,orcanos_user_name,orcanos_account,last_login_at,created_at';

export function staffDomain(): string {
  return platformEmailDomain().toLowerCase();
}

export function isStaffEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${staffDomain()}`);
}

/** Every `users` row on the staff domain — admins and demoted ones, so a removal can be undone. */
export async function listStaff(): Promise<StaffRow[]> {
  // `ilike` treats `_` as a wildcard; the exact suffix is re-checked in code.
  const rows = await pgGet<StaffRow[]>(
    `users?email=ilike.${encodeURIComponent(`*@${staffDomain()}`)}&select=${COLUMNS}&order=email.asc`,
  );
  return rows.filter((r) => isStaffEmail(r.email ?? ''));
}

export async function getStaff(id: number): Promise<StaffRow | null> {
  const rows = await pgGet<StaffRow[]>(`users?id=eq.${id}&select=${COLUMNS}`);
  return rows[0] ?? null;
}

async function findByEmail(email: string): Promise<StaffRow | null> {
  const wanted = email.trim().toLowerCase();
  const rows = await pgGet<StaffRow[]>(
    `users?email=ilike.${encodeURIComponent(wanted)}&select=${COLUMNS}&limit=20`,
  );
  return rows.find((r) => (r.email ?? '').trim().toLowerCase() === wanted) ?? null;
}

/**
 * Another row already holding this Orcanos username would make sign-in ambiguous: the
 * login looks the name up across rows, and linking answers `orcanos_identity_already_linked`.
 */
export async function usernameTakenBy(username: string, exceptId?: number): Promise<StaffRow | null> {
  const wanted = username.trim().toLowerCase();
  const rows = await pgGet<StaffRow[]>(
    `users?orcanos_user_name=ilike.${encodeURIComponent(wanted)}&select=${COLUMNS}&limit=20`,
  );
  return (
    rows.find((r) => (r.orcanos_user_name ?? '').trim().toLowerCase() === wanted && r.id !== exceptId) ?? null
  );
}

/**
 * Add a person, or re-admit an existing row with the same email (QMS may already have one).
 * `orcanos_account` is cleared whenever the username changes: it is filled on the next
 * successful sign-in, and a stale value would refuse it as `orcanos_identity_mismatch`.
 */
export async function upsertStaff(fields: {
  email: string;
  display_name: string;
  orcanos_user_name: string;
}): Promise<{ row: StaffRow; created: boolean; before: StaffRow | null }> {
  const existing = await findByEmail(fields.email);
  if (existing) {
    const patch: Record<string, unknown> = {
      role: 'admin',
      orcanos_user_name: fields.orcanos_user_name,
    };
    if (fields.display_name) patch.display_name = fields.display_name;
    if ((existing.orcanos_user_name ?? '').toLowerCase() !== fields.orcanos_user_name.toLowerCase()) {
      patch.orcanos_account = null;
    }
    const rows = await pgPatch<StaffRow[]>(`users?id=eq.${existing.id}&select=${COLUMNS}`, patch);
    return { row: rows[0], created: false, before: existing };
  }
  const rows = await pgPost<StaffRow[]>(`users?select=${COLUMNS}`, {
    email: fields.email.trim().toLowerCase(),
    display_name: fields.display_name || null,
    auth_method: 'orcanos',
    role: 'admin',
    orcanos_user_name: fields.orcanos_user_name,
  });
  return { row: rows[0], created: true, before: null };
}

export async function updateStaff(
  before: StaffRow,
  fields: { orcanos_user_name?: string; display_name?: string; role?: 'admin' | 'user' },
): Promise<StaffRow> {
  const patch: Record<string, unknown> = {};
  if (fields.display_name !== undefined) patch.display_name = fields.display_name || null;
  if (fields.role) patch.role = fields.role;
  if (fields.orcanos_user_name !== undefined) {
    patch.orcanos_user_name = fields.orcanos_user_name || null;
    if ((before.orcanos_user_name ?? '').toLowerCase() !== fields.orcanos_user_name.toLowerCase()) {
      patch.orcanos_account = null;
    }
  }
  const rows = await pgPatch<StaffRow[]>(`users?id=eq.${before.id}&select=${COLUMNS}`, patch);
  return rows[0];
}
