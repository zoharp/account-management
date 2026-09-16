/**
 * PATCH /api/iso27001/[id] — resolve one ISO 27001 control.
 *
 * "Resolve" here means an operator answered the question a scan can't (Is it
 * documented? Do we have a signed DPA?), optionally pointed at evidence, and
 * asserted the status that answer implies. `resolved: false` saves the same
 * answer as a comment while leaving the control open. Every save is first
 * appended to `iso27001_control_notes` (sql/006), so the current row is just
 * the latest note — nothing an operator wrote is ever overwritten.
 *
 * It never touches `status` — that
 * field stays the automated scan's own verdict from the last skill run, so a
 * re-import can't silently wipe out a human's answer, and the two are always
 * visible side by side.
 */

import { requirePlatformStaff } from '@/lib/session';
import { pgGet, pgPatch, pgPost } from '@/lib/supabase';
import { latestRun } from '@/lib/iso27001';
import { logSecurityEvent } from '@/lib/audit';
import type { Iso27001ControlRow, Iso27001Status } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_STATUS = new Set<Iso27001Status>(['pass', 'partial', 'fail', 'blocked', 'not_applicable']);

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requirePlatformStaff();
  if (error) return error;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    resolution_answer?: string;
    resolution_evidence_link?: string | null;
    resolved_status?: string;
    resolved?: boolean;
  };

  if (typeof body.resolution_answer !== 'string' || !body.resolution_answer.trim()) {
    return Response.json({ detail: 'resolution_answer is required' }, { status: 400 });
  }
  if (body.resolved_status && !VALID_STATUS.has(body.resolved_status as Iso27001Status)) {
    return Response.json({ detail: `resolved_status must be one of ${[...VALID_STATUS].join(', ')}` }, { status: 400 });
  }
  const link = (body.resolution_evidence_link ?? '').trim();
  if (link && !/^https?:\/\//i.test(link)) {
    return Response.json({ detail: 'resolution_evidence_link must be a full http(s) URL' }, { status: 400 });
  }

  const resolved = body.resolved !== false;
  const resolvedStatus = (body.resolved_status as Iso27001Status | undefined) || null;

  try {
    const found = await pgGet<Pick<Iso27001ControlRow, 'system_name' | 'control_id'>[]>(
      `iso27001_controls?select=system_name,control_id&id=eq.${encodeURIComponent(id)}`,
    );
    if (found.length === 0) return Response.json({ detail: 'Control not found' }, { status: 404 });
    const current = found[0];
    // History first: if this fails nothing changes, so the current row can
    // never hold an answer the history lacks.
    const run = await latestRun(current.system_name);
    await pgPost('iso27001_control_notes', {
      system_name: current.system_name,
      control_id: current.control_id,
      run_id: run?.id ?? null,
      answer: body.resolution_answer.trim(),
      evidence_link: link || null,
      asserted_status: resolvedStatus,
      resolved,
      author_id: user.id,
      author_email: user.email,
    });
  } catch (e) {
    return Response.json({ detail: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  const updates = {
    resolved,
    resolution_answer: body.resolution_answer.trim(),
    resolution_evidence_link: link || null,
    resolved_status: resolvedStatus,
    resolved_by: user.id,
    resolved_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  try {
    const rows = await pgPatch<Iso27001ControlRow[]>(
      `iso27001_controls?id=eq.${encodeURIComponent(id)}`,
      updates,
    );
    if (rows.length === 0) {
      return Response.json({ detail: 'Control not found' }, { status: 404 });
    }
    await logSecurityEvent('iso27001_control_resolved', {
      user,
      detail: { control_id: rows[0].control_id, system_name: rows[0].system_name, resolved },
    });
    return Response.json({ control: rows[0] });
  } catch (e) {
    return Response.json({ detail: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
