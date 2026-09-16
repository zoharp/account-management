/**
 * GET /api/iso27001/[id]/notes — every answer ever saved on one control,
 * newest first. `[id]` is the `iso27001_controls` row; notes are keyed by
 * (system_name, control_id) so they outlive that row.
 */

import { requirePlatformStaff } from '@/lib/session';
import { pgGet } from '@/lib/supabase';
import type { Iso27001ControlNote, Iso27001ControlRow } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requirePlatformStaff();
  if (error) return error;

  const { id } = await params;
  try {
    const rows = await pgGet<Pick<Iso27001ControlRow, 'system_name' | 'control_id'>[]>(
      `iso27001_controls?select=system_name,control_id&id=eq.${encodeURIComponent(id)}`,
    );
    if (rows.length === 0) return Response.json({ detail: 'Control not found' }, { status: 404 });
    const { system_name, control_id } = rows[0];
    const notes = await pgGet<Iso27001ControlNote[]>(
      `iso27001_control_notes?select=*&system_name=eq.${encodeURIComponent(system_name)}` +
        `&control_id=eq.${encodeURIComponent(control_id)}&order=created_at.desc`,
    );
    return Response.json({ notes });
  } catch (e) {
    return Response.json({ detail: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
