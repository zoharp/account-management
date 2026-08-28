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
import type { AuditLogRow } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { error } = await requirePlatformStaff();
  if (error) return error;

  const url = new URL(req.url);
  const eventType = url.searchParams.get('event_type');
  const accountName = url.searchParams.get('account_name');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 200) || 200, 1000);
  const offset = Number(url.searchParams.get('offset') ?? 0) || 0;

  let path = 'security_audit_log?select=*&order=created_at.desc';
  if (eventType) path += `&event_type=eq.${encodeURIComponent(eventType)}`;
  if (accountName) path += `&account_name=eq.${encodeURIComponent(accountName)}`;
  path += `&limit=${limit}&offset=${offset}`;

  try {
    return Response.json({ logs: await pgGet<AuditLogRow[]>(path) });
  } catch (e) {
    return Response.json({ detail: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
