/**
 * GET/PUT /api/settings/credit-limits — the DEFAULT AI credit limits for every account, and the
 * list of accounts that have their own.
 *
 * GET → { defaults, updated_at, updated_by, own: [{ tenant, limits, updated_at, updated_by }], migrated }
 * PUT { limits, reset_tenants?: string[] } → saves the default; each tenant in `reset_tenants` loses its
 *     own limits and follows the (new) default. The screen ticks every account whose own limits differ
 *     and lets staff untick the ones to keep. Audited as `platform_setting_changed`.
 *
 * Storage and rules: lib/credit-limits.ts. Staff only.
 */

import { requirePlatformStaff } from '@/lib/session';
import { logSecurityEvent } from '@/lib/audit';
import { normaliseKindKey } from '@/lib/account-kind';
import {
  clearOwnLimits,
  getDefaultLimits,
  isMissingTable,
  listOwnLimits,
  setDefaultLimits,
} from '@/lib/credit-limits';
import { CREDIT_LIMIT_DEFAULTS, validateCreditLimits } from '@/lib/credit-limits-key';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TENANT_RE = /^[a-z0-9._ -]{1,120}$/;

export async function GET() {
  const { error } = await requirePlatformStaff();
  if (error) return error;
  try {
    const d = await getDefaultLimits();
    const own = await listOwnLimits(d.limits);
    return Response.json({
      defaults: d.limits,
      updated_at: d.updated_at,
      updated_by: d.updated_by,
      own: Object.entries(own)
        .map(([tenant, s]) => ({ tenant, ...s }))
        .sort((a, b) => a.tenant.localeCompare(b.tenant)),
      migrated: true,
    });
  } catch (e) {
    if (isMissingTable(e)) {
      return Response.json({ defaults: CREDIT_LIMIT_DEFAULTS, updated_at: null, updated_by: null, own: [], migrated: false });
    }
    return Response.json({ detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

export async function PUT(req: Request) {
  const { user, error } = await requirePlatformStaff();
  if (error) return error;
  const body = (await req.json().catch(() => ({}))) as { limits?: unknown; reset_tenants?: unknown };
  const limits = validateCreditLimits(body.limits);
  if (typeof limits === 'string') return Response.json({ detail: limits }, { status: 400 });

  const reset = Array.isArray(body.reset_tenants)
    ? [...new Set(body.reset_tenants.filter((t): t is string => typeof t === 'string').map(normaliseKindKey))]
    : [];
  if (reset.some((t) => !TENANT_RE.test(t))) {
    return Response.json({ detail: 'reset_tenants holds an invalid tenant.' }, { status: 400 });
  }

  let previous = CREDIT_LIMIT_DEFAULTS;
  const failed: string[] = [];
  try {
    previous = (await getDefaultLimits()).limits;
    await setDefaultLimits(limits, user.email);
  } catch (e) {
    const missing = isMissingTable(e);
    return Response.json(
      { detail: missing ? 'The master database has no platform_settings table yet — run sql/008_platform_settings.sql first.' : String(e instanceof Error ? e.message : e) },
      { status: missing ? 409 : 502 },
    );
  }
  for (const t of reset) {
    try {
      await clearOwnLimits(t);
    } catch {
      failed.push(t);
    }
  }

  await logSecurityEvent('platform_setting_changed', {
    user,
    detail: { key: 'credit_limits', previous, limits, reset_to_default: reset.filter((t) => !failed.includes(t)), failed },
  });
  if (failed.length) {
    return Response.json(
      { detail: `Default saved, but these accounts still have their own limits: ${failed.join(', ')}. Try again.`, limits, failed },
      { status: 207 },
    );
  }
  return Response.json({ ok: true, limits, reset });
}
