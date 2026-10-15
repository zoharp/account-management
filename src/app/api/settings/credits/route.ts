/**
 * GET/PUT /api/settings/credits — the one credits setting, for ALL accounts.
 *
 * Stored in master `platform_settings` (sql/008) under key `credits`:
 *   { credits_per_usd, markup }   →   credits = cost_usd × markup × credits_per_usd
 *
 * Ask Paul reads the same row (cached 30 s) and shows customers credits instead of $ and
 * tokens. Defaults mirror `CREDIT_DEFAULTS` in Ask Paul's backend/api.py — change both together.
 * A missing table reads as the defaults and a write answers 409 naming the migration.
 */

import { requirePlatformStaff } from '@/lib/session';
import { pgGet, pgUpsert } from '@/lib/supabase';
import { logSecurityEvent } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULTS = { credits_per_usd: 100, markup: 1 };

export async function GET() {
  const { error } = await requirePlatformStaff();
  if (error) return error;
  try {
    const rows = await pgGet<Array<{ value?: Partial<typeof DEFAULTS>; updated_at?: string; updated_by?: string }>>(
      'platform_settings?key=eq.credits&select=value,updated_at,updated_by',
    );
    const v = rows[0]?.value ?? {};
    return Response.json({
      credits_per_usd: Number(v.credits_per_usd) > 0 ? Number(v.credits_per_usd) : DEFAULTS.credits_per_usd,
      markup: Number(v.markup) > 0 ? Number(v.markup) : DEFAULTS.markup,
      updated_at: rows[0]?.updated_at ?? null,
      updated_by: rows[0]?.updated_by ?? null,
      migrated: true,
    });
  } catch (e) {
    // Table not created yet → show the defaults and say so, rather than a broken screen.
    const msg = e instanceof Error ? e.message : String(e);
    if (/platform_settings|42P01|PGRST205/i.test(msg)) {
      return Response.json({ ...DEFAULTS, updated_at: null, updated_by: null, migrated: false });
    }
    return Response.json({ detail: msg }, { status: 502 });
  }
}

export async function PUT(req: Request) {
  const { user, error } = await requirePlatformStaff();
  if (error) return error;
  const body = (await req.json().catch(() => ({}))) as { credits_per_usd?: unknown; markup?: unknown };
  const credits_per_usd = Number(body.credits_per_usd);
  const markup = Number(body.markup);
  if (!(credits_per_usd > 0) || credits_per_usd > 1_000_000) {
    return Response.json({ detail: 'Credits per $1 must be a number above 0.' }, { status: 400 });
  }
  if (!(markup > 0) || markup > 1000) {
    return Response.json({ detail: 'Markup must be a number above 0.' }, { status: 400 });
  }
  try {
    await pgUpsert('platform_settings', 'key', {
      key: 'credits',
      value: { credits_per_usd, markup },
      updated_at: new Date().toISOString(),
      updated_by: user.email,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const missing = /platform_settings|42P01|PGRST205/i.test(msg);
    return Response.json(
      { detail: missing ? 'The master database has no platform_settings table yet — run sql/008_platform_settings.sql first.' : msg },
      { status: missing ? 409 : 502 },
    );
  }
  await logSecurityEvent('platform_setting_changed', {
    user,
    detail: { key: 'credits', credits_per_usd, markup },
  });
  return Response.json({ ok: true, credits_per_usd, markup });
}
