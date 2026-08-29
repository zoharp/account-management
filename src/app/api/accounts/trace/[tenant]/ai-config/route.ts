/**
 * POST /api/accounts/trace/:tenant/ai-config — set (or reset) how AI runs for
 * one traceability tenant.
 *
 * A `provider` of '' resets the tenant to the server's env default and drops
 * its config row entirely; the trace API treats that as a delete, so no key is
 * left behind.
 *
 * The key is write-only in both directions: it is never returned by the trace
 * API and never echoed here. Only `has_key` ever reaches the browser.
 */

import { requirePlatformStaff } from '@/lib/session';
import { logSecurityEvent } from '@/lib/audit';
import { saveTraceAiConfig, traceConfigured, TraceApiError } from '@/lib/trace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ tenant: string }> }) {
  const { user, error } = await requirePlatformStaff();
  if (error) return error;
  if (!traceConfigured()) {
    return Response.json(
      { detail: 'Traceability is not connected (TRACE_API_URL / TRACE_ADMIN_PASSWORD).' },
      { status: 503 },
    );
  }

  const { tenant } = await ctx.params;
  const name = tenant.toLowerCase();
  const body = (await req.json().catch(() => ({}))) as {
    provider?: string;
    model?: string;
    api_key?: string | null;
  };

  const provider = (body.provider ?? '').trim().toLowerCase();

  // Three-state, preserved end to end: undefined from the client must arrive as
  // null ("keep the stored key"), NOT as '' ("clear it"). Collapsing the two is
  // how a working tenant silently falls back to the shared env key.
  const apiKey = body.api_key === undefined ? null : body.api_key;

  try {
    await saveTraceAiConfig(name, {
      provider,
      model: provider ? (body.model ?? '') : '',
      api_key: provider ? apiKey : null,
    });
    await logSecurityEvent('trace_ai_config_changed', {
      user,
      accountName: name,
      detail: {
        provider: provider || '(server default)',
        model: body.model ?? '',
        key: apiKey === null ? 'kept' : apiKey === '' ? 'cleared' : 'set',
      },
    });
    return Response.json({ ok: true, tenant: name, provider });
  } catch (e) {
    const status = e instanceof TraceApiError ? e.status : 500;
    return Response.json(
      { detail: e instanceof Error ? e.message : String(e) },
      { status: status === 401 ? 502 : status },
    );
  }
}
