/**
 * GET /api/usage?region=us|eu&account=<tenant>&days=30 — anonymous app usage totals per
 * account, proxied from traceability-matrix `/api/admin/usage/stats` (no user ids exist there).
 * Platform staff only (customers never reach this console). Read-only, so no audit entry.
 */

import { requirePlatformStaff } from '@/lib/session';
import { getUsageStats, traceRegions, TraceApiError } from '@/lib/trace';
import type { DataRegion } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { error } = await requirePlatformStaff();
  if (error) return error;
  const url = new URL(req.url);
  const regions = traceRegions();
  if (!regions.length) {
    return Response.json({ detail: 'Traceability is not connected (TRACE_API_URL / TRACE_ADMIN_PASSWORD).' }, { status: 503 });
  }
  const want = url.searchParams.get('region') as DataRegion | null;
  const region = want && regions.includes(want) ? want : regions[0];
  const account = (url.searchParams.get('account') || '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 80);
  const days = Math.max(1, Math.min(3650, Number(url.searchParams.get("days")) || 30));
  try {
    const data = await getUsageStats(region, account, days);
    return Response.json({ region, regions, ...data });
  } catch (e) {
    const status = e instanceof TraceApiError ? e.status : 502;
    return Response.json({ detail: e instanceof Error ? e.message : String(e), region, regions },
      { status: status === 404 ? 501 : status });
  }
}
