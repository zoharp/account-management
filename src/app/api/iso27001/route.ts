/**
 * GET /api/iso27001 — ISO 27001 Annex A control status for one audited system.
 *
 * Reads `iso27001_controls`, seeded by `sql/005_iso27001_controls.sql` from
 * the `compliance-audit` Claude skill's ledger. This route never runs the
 * skill itself — it only serves whatever the last seed/import wrote.
 */

import { requirePlatformStaff } from '@/lib/session';
import { pgGet } from '@/lib/supabase';
import { DEFAULT_ISO27001_SYSTEM } from '@/lib/iso27001-systems';
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
    const rows = await pgGet<Iso27001ControlRow[]>(path);
    // `control_id` sorts lexically in PostgREST ('A.5.10' before 'A.5.2'), so
    // fix the order here the same way the compliance-audit skill's report
    // generator does — split on '.', compare numerically.
    rows.sort((a, b) => {
      const pa = a.control_id.slice(2).split('.').map(Number);
      const pb = b.control_id.slice(2).split('.').map(Number);
      return pa[0] - pb[0] || (pa[1] ?? 0) - (pb[1] ?? 0);
    });
    return Response.json({ controls: rows });
  } catch (e) {
    return Response.json({ detail: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
