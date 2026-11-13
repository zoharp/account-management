/**
 * GET/PUT /api/accounts/credit-limits — ONE account's AI credit limits and what it has used.
 *
 * GET ?tenant=<key>&account_id=<master uuid, optional>&region=<us|eu, optional>
 *   → { defaults, own: StoredLimits | null, usage: CreditUsage | null, usage_note }
 *   `tenant` is `kindKeyOf(row)` — the same key as the account type. Usage is combined: the Ask Paul
 *   half from the master ledger (needs `account_id`), the traceability half from the trace app's own
 *   ledger (needs a trace row). Either half missing reads as 0 with a note saying which.
 * PUT { tenant, limits }        → this account gets its own limits.
 * PUT { tenant, limits: null }  → back to the default.
 * Audited as `account_credit_limits_changed`. Staff only. Static segment beside `api/accounts/[id]`.
 */

import { requirePlatformStaff } from '@/lib/session';
import { logSecurityEvent } from '@/lib/audit';
import { normaliseKindKey } from '@/lib/account-kind';
import {
  clearOwnLimits,
  getDefaultLimits,
  getOwnLimits,
  isMissingTable,
  setOwnLimits,
  askPaulUsageFromMaster,
  buildUsage,
} from '@/lib/credit-limits';
import { CREDIT_LIMIT_DEFAULTS, validateCreditLimits } from '@/lib/credit-limits-key';
import { getTraceCreditUsage, TraceApiError, traceRegions } from '@/lib/trace';
import { parseRegion } from '@/lib/regions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TENANT_RE = /^[a-z0-9._ -]{1,120}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(req: Request) {
  const { error } = await requirePlatformStaff();
  if (error) return error;
  const url = new URL(req.url);
  const tenant = normaliseKindKey(url.searchParams.get('tenant') ?? '');
  const accountId = url.searchParams.get('account_id') ?? '';
  const region = parseRegion(url.searchParams.get('region') ?? 'us');
  const traceTenant = url.searchParams.get('trace') === '1';
  if (!TENANT_RE.test(tenant)) return Response.json({ detail: 'Missing or invalid: tenant' }, { status: 400 });
  if (accountId && !UUID_RE.test(accountId)) return Response.json({ detail: 'Invalid account_id' }, { status: 400 });

  let defaults = CREDIT_LIMIT_DEFAULTS;
  let own = null;
  try {
    defaults = (await getDefaultLimits()).limits;
    own = await getOwnLimits(tenant, defaults);
  } catch (e) {
    if (!isMissingTable(e)) return Response.json({ detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
  const limits = own?.limits ?? defaults;

  // Ask Paul half — master ledger. Traceability half — the trace app's own ledger (see lib/credit-limits.ts).
  const notes: string[] = [];
  const ask_paul = { day: 0, week: 0, month: 0 };
  const traceability = { day: 0, week: 0, month: 0 };
  if (accountId) {
    try {
      Object.assign(ask_paul, await askPaulUsageFromMaster(accountId));
    } catch (e) {
      notes.push(`Ask Paul usage unavailable: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (traceTenant && region && traceRegions().includes(region)) {
    try {
      const t = await getTraceCreditUsage(tenant, region);
      Object.assign(traceability, t.by_app?.traceability ?? {});
    } catch (e) {
      notes.push(
        e instanceof TraceApiError && e.status === 404
          ? 'Traceability usage needs a newer traceability build — counted as 0.'
          : `Traceability usage unavailable: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  const usage = buildUsage(limits, Boolean(own), { ask_paul, traceability }, 'Ask Paul: master ledger · Traceability: traceability ledger');
  return Response.json({ defaults, own, usage, usage_note: notes.join(' ') });
}

export async function PUT(req: Request) {
  const { user, error } = await requirePlatformStaff();
  if (error) return error;
  const body = (await req.json().catch(() => ({}))) as { tenant?: unknown; limits?: unknown };
  const tenant = typeof body.tenant === 'string' ? normaliseKindKey(body.tenant) : '';
  if (!TENANT_RE.test(tenant)) return Response.json({ detail: 'Missing or invalid: tenant' }, { status: 400 });

  try {
    if (body.limits === null) {
      await clearOwnLimits(tenant);
      await logSecurityEvent('account_credit_limits_changed', { user, accountName: tenant, detail: { tenant, limits: 'default' } });
      return Response.json({ ok: true, own: null });
    }
    const limits = validateCreditLimits(body.limits);
    if (typeof limits === 'string') return Response.json({ detail: limits }, { status: 400 });
    await setOwnLimits(tenant, limits, user.email);
    await logSecurityEvent('account_credit_limits_changed', { user, accountName: tenant, detail: { tenant, limits } });
    return Response.json({ ok: true, own: { limits } });
  } catch (e) {
    const missing = isMissingTable(e);
    return Response.json(
      { detail: missing ? 'The master database has no platform_settings table yet — run sql/008_platform_settings.sql first.' : String(e instanceof Error ? e.message : e) },
      { status: missing ? 409 : 502 },
    );
  }
}
