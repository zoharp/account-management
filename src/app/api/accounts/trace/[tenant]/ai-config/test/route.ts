/**
 * POST /api/accounts/trace/:tenant/ai-config/test — live-verify a provider,
 * model and key against the real API BEFORE anything is stored.
 *
 * Same rule this app already applies to a tenant's vector key: a bad AI key is
 * undetectable from the UI, so the first person to find out is a customer whose
 * generate button fails. Test first, save second.
 *
 * The typed key is forwarded and never persisted here. When it is blank the
 * trace side resolves the tenant's stored key (or the server env key), which is
 * why the tenant travels with the request.
 */

import { requirePlatformStaff } from '@/lib/session';
import { logSecurityEvent } from '@/lib/audit';
import { testTraceAiConfig, traceConfigured, TraceApiError } from '@/lib/trace';

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
  const body = (await req.json().catch(() => ({}))) as {
    provider?: string;
    model?: string;
    api_key?: string | null;
  };

  const provider = (body.provider ?? '').trim().toLowerCase();
  // A blank key means the trace side resolves the tenant's STORED key (or the
  // server env key) and makes a real call with it — secret use, not just a form
  // validation, so it is recorded either way. The key itself is never logged.
  const usedStoredKey = !body.api_key;

  try {
    const result = await testTraceAiConfig({
      provider,
      model: body.model ?? '',
      api_key: body.api_key === undefined ? null : body.api_key,
      account: tenant.toLowerCase(),
    });
    await logSecurityEvent('trace_ai_key_tested', {
      user,
      accountName: tenant.toLowerCase(),
      detail: {
        provider: provider || '(server default)',
        model: body.model ?? '',
        used_stored_key: usedStoredKey,
        message: result.message,
      },
      success: Boolean(result.ok),
    });
    return Response.json(result);
  } catch (e) {
    const status = e instanceof TraceApiError ? e.status : 500;
    return Response.json(
      { ok: false, message: e instanceof Error ? e.message : String(e) },
      { status: status === 401 ? 502 : status },
    );
  }
}
