/**
 * GET /api/accounts/trace/:tenant/usage — one tenant's traceability AI calls.
 *
 * The counterpart of `api/accounts/:id/usage-logs`, which reads the master DB's
 * `account_usage_logs` for QMS AI. Two ledgers, deliberately not merged: they
 * are written by different runtimes at different granularity and each freezes
 * its own cost at write time. The list unions the totals; the drill-downs stay
 * separate so a figure always traces back to the system that produced it.
 *
 * Unlike the master side, these totals ARE lifetime — `list_ai_usage` aggregates
 * over the whole table, not over the returned page.
 */

import { requirePlatformStaff } from '@/lib/session';
import { listTraceUsage, traceConfigured, TraceApiError } from '@/lib/trace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ tenant: string }> }) {
  const { error } = await requirePlatformStaff();
  if (error) return error;
  if (!traceConfigured()) {
    return Response.json(
      { detail: 'Traceability is not connected (TRACE_API_URL / TRACE_ADMIN_PASSWORD).' },
      { status: 503 },
    );
  }

  const { tenant } = await ctx.params;
  const limit = Math.min(Number(new URL(req.url).searchParams.get('limit') ?? 200) || 200, 2000);

  try {
    return Response.json(await listTraceUsage(tenant.toLowerCase(), limit));
  } catch (e) {
    const status = e instanceof TraceApiError ? e.status : 500;
    return Response.json(
      { detail: e instanceof Error ? e.message : String(e) },
      { status: status === 401 ? 502 : status },
    );
  }
}
