/**
 * GET /api/accounts/:id/usage-logs — billing drill-down for one account.
 * Port of `GET /admin/accounts/{account_id}/usage-logs`.
 *
 * Reads the master DB's mirrored `account_usage_logs`, not the tenant's own
 * `usage_logs`, so no per-account connection is needed.
 *
 * Carried-over caveat: the totals are summed over the returned PAGE, not over
 * the whole account. With the default limit of 200 that means "total across the
 * 200 most recent events". The list view's Total Cost column is the true
 * lifetime figure — it comes from the `account_cost_totals()` RPC.
 */

import { requirePlatformStaff } from '@/lib/session';
import { pgGet } from '@/lib/supabase';
import type { UsageLogRow } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await requirePlatformStaff();
  if (error) return error;

  const { id } = await ctx.params;
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 200) || 200, 1000);
  const offset = Number(url.searchParams.get('offset') ?? 0) || 0;

  try {
    const logs = await pgGet<UsageLogRow[]>(
      `account_usage_logs?select=*&account_id=eq.${encodeURIComponent(id)}` +
        `&order=created_at.desc&limit=${limit}&offset=${offset}`,
    );

    const totalTokens = logs.reduce((sum, l) => sum + (Number(l.tokens) || 0), 0);
    const totalCost = logs.reduce((sum, l) => sum + (Number(l.cost_usd) || 0), 0);

    return Response.json({
      logs,
      total_tokens: totalTokens,
      total_cost_usd: Math.round(totalCost * 1e6) / 1e6,
    });
  } catch (e) {
    return Response.json({ detail: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
