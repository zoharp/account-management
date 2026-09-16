/**
 * GET /api/iso27001/runs/[id] — one saved run and its control snapshot, exactly
 * as that run saw them. Read-only: runs are never edited after import.
 */

import { requirePlatformStaff } from '@/lib/session';
import { pgGet } from '@/lib/supabase';
import { sortByControlId } from '@/lib/iso27001';
import type { Iso27001AuditRun, Iso27001RunControl } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requirePlatformStaff();
  if (error) return error;

  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ detail: 'Run not found' }, { status: 404 });

  try {
    const [runs, controls] = await Promise.all([
      pgGet<Iso27001AuditRun[]>(`iso27001_audit_runs?select=*&id=eq.${id}`),
      pgGet<Iso27001RunControl[]>(`iso27001_run_controls?select=*&run_id=eq.${id}`),
    ]);
    if (runs.length === 0) return Response.json({ detail: 'Run not found' }, { status: 404 });
    return Response.json({ run: runs[0], controls: sortByControlId(controls) });
  } catch (e) {
    return Response.json({ detail: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
