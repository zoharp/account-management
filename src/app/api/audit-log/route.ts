/**
 * GET /api/audit-log — the security-event trail.
 * Port of `GET /admin/audit-log`.
 *
 * Shared with the QMS backend: both apps write to `security_audit_log`, so this
 * is one continuous trail across the platform, not this app's own log.
 * ISO 27001:2022 A.8.15 / A.8.16 evidence.
 */

import { requirePlatformStaff } from '@/lib/session';
import { pgGet } from '@/lib/supabase';
import { VALID_EVENT_TYPE } from '@/lib/audit-events';
import type { AuditLogRow } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { error } = await requirePlatformStaff();
  if (error) return error;

  const url = new URL(req.url);
  const accountName = url.searchParams.get('account_name');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 200) || 200, 1000);
  const offset = Number(url.searchParams.get('offset') ?? 0) || 0;

  // `event_type` takes one type or a comma-separated list, so the page can ask
  // for several groups at once ("sign-in OR secrets") in a single query.
  //
  // These values land inside a PostgREST `in.(…)` list, so they are validated
  // against a narrow shape rather than escaped: every event type the platform
  // writes is lower-case snake_case, and anything that could terminate the list
  // or add a filter fails the pattern. An entirely invalid selection is treated
  // as "no event-type filter" rather than as an error — the operator sees the
  // unfiltered trail, which is the safe direction to fail for an audit view.
  const requested = (url.searchParams.get('event_type') ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t && VALID_EVENT_TYPE.test(t));
  const types = [...new Set(requested)];

  let path = 'security_audit_log?select=*&order=created_at.desc';
  if (types.length === 1) path += `&event_type=eq.${encodeURIComponent(types[0])}`;
  else if (types.length > 1) path += `&event_type=in.(${types.join(',')})`;
  if (accountName) path += `&account_name=eq.${encodeURIComponent(accountName)}`;
  path += `&limit=${limit}&offset=${offset}`;

  try {
    return Response.json({ logs: await pgGet<AuditLogRow[]>(path) });
  } catch (e) {
    return Response.json({ detail: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
