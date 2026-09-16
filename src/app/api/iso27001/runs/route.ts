/**
 * /api/iso27001/runs — saved `compliance-audit` runs for one system.
 *
 * GET  ?system=<key>             newest first.
 * POST { system_name, ledger }   import a skill ledger as a new run.
 *
 * An import writes three things, in this order, over PostgREST (no
 * transaction available): the run row, its immutable control snapshot, then an
 * upsert of the *automated* columns of `iso27001_controls`. If the snapshot
 * fails the run row is deleted again, so a run never exists without its
 * controls. The upsert sends no resolution column, so an import never touches
 * an operator's answer.
 */

import { requirePlatformStaff } from '@/lib/session';
import { pgDelete, pgGet, pgPost, pgUpsert } from '@/lib/supabase';
import { logSecurityEvent } from '@/lib/audit';
import { ISO27001_SYSTEMS } from '@/lib/iso27001-systems';
import { parseLedger, summarize } from '@/lib/iso27001';
import type { Iso27001AuditRun } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function knownSystem(key: unknown): key is string {
  return typeof key === 'string' && ISO27001_SYSTEMS.some((s) => s.key === key);
}

export async function GET(req: Request) {
  const { error } = await requirePlatformStaff();
  if (error) return error;

  const system = new URL(req.url).searchParams.get('system');
  if (!knownSystem(system)) return Response.json({ detail: 'Unknown system' }, { status: 400 });

  try {
    const runs = await pgGet<Iso27001AuditRun[]>(
      `iso27001_audit_runs?select=*&system_name=eq.${encodeURIComponent(system)}` +
        `&order=run_date.desc,created_at.desc`,
    );
    return Response.json({ runs });
  } catch (e) {
    return Response.json({ detail: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { user, error } = await requirePlatformStaff();
  if (error) return error;

  const body = (await req.json().catch(() => null)) as { system_name?: unknown; ledger?: unknown } | null;
  const system = body?.system_name;
  if (!knownSystem(system)) return Response.json({ detail: 'Unknown system' }, { status: 400 });

  const parsed = parseLedger(body?.ledger);
  if ('error' in parsed) return Response.json({ detail: parsed.error }, { status: 400 });
  const { run_date, controls } = parsed.ledger;

  let run: Iso27001AuditRun;
  try {
    [run] = await pgPost<Iso27001AuditRun[]>('iso27001_audit_runs', {
      system_name: system,
      run_date,
      source: 'import',
      imported_by: user.id,
      imported_by_email: user.email,
      control_count: controls.length,
      summary: summarize(controls),
    });
  } catch (e) {
    return Response.json({ detail: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  try {
    await pgPost('iso27001_run_controls', controls.map((c) => ({ run_id: run.id, ...c })));
  } catch (e) {
    await pgDelete(`iso27001_audit_runs?id=eq.${run.id}`).catch(() => undefined);
    return Response.json({ detail: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  try {
    const now = new Date().toISOString();
    await pgUpsert(
      'iso27001_controls',
      'system_name,control_id',
      controls.map((c) => ({ system_name: system, ...c, last_checked: run_date, updated_at: now })),
    );
  } catch (e) {
    // The run is saved and correct; only the current view is stale. Say so
    // rather than rolling back a valid snapshot.
    return Response.json(
      { run, detail: `Run saved, but the current view was not updated: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }

  await logSecurityEvent('iso27001_run_imported', {
    user,
    detail: { system_name: system, run_id: run.id, run_date, control_count: controls.length },
  });
  return Response.json({ run }, { status: 201 });
}
