/**
 * GET /api/iso27001 — current ISO 27001 Annex A control status for one audited system.
 *
 * Reads `iso27001_controls` (sql/005): the automated status from the newest
 * imported run plus whatever an operator last answered. Past runs are under
 * `api/iso27001/runs`; this route never runs the `compliance-audit` skill.
 */

import { requirePlatformStaff } from '@/lib/session';
import { pgGet } from '@/lib/supabase';
import { DEFAULT_ISO27001_SYSTEM } from '@/lib/iso27001-systems';
import { latestRun, sortByControlId } from '@/lib/iso27001';
import type { Iso27001ControlRow } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { error } = await requirePlatformStaff();
  if (error) return error;

  const url = new URL(req.url);
  const system = url.searchParams.get('system') || DEFAULT_ISO27001_SYSTEM;

  const path =
    `iso27001_controls?select=*&system_name=eq.${encodeURIComponent(system)}` +
    `&order=control_id.asc`;

  try {
    const [rows, run] = await Promise.all([pgGet<Iso27001ControlRow[]>(path), latestRun(system)]);
    return Response.json({ controls: sortByControlId(rows), run });
  } catch (e) {
    return Response.json({ detail: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
