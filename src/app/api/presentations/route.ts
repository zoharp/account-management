/**
 * GET /api/presentations?region=us|eu&deck=<slug>&days=90 — who opens the customer
 * presentations, proxied from traceability-matrix `/api/admin/decks/stats`.
 * Platform staff only (customers never reach this console). Read-only, so no audit entry.
 */

import { requirePlatformStaff } from '@/lib/session';
import { getDeckStats, traceRegions, TraceApiError } from '@/lib/trace';
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
  const deck = (url.searchParams.get('deck') || '').replace(/[^a-z0-9-]/g, '').slice(0, 60);
  const days = Math.max(1, Math.min(3650, Number(url.searchParams.get('days')) || 90));
  try {
    const data = await getDeckStats(region, deck, days);
    return Response.json({ region, regions, ...data });
  } catch (e) {
    const status = e instanceof TraceApiError ? e.status : 502;
    return Response.json({ detail: e instanceof Error ? e.message : String(e), region, regions },
      { status: status === 404 ? 501 : status });
  }
}
