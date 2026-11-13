/**
 * GET /api/accounts/kind — every account type, `{ kinds: { <tenant>: AccountKind } }`.
 *                          A tenant not in the map is a Customer. Used by the Usage screen.
 * PUT /api/accounts/kind — `{ tenant, kind }` sets one. Audited as `account_kind_changed`.
 *
 * Staff only. Storage and why it is keyed on the tenant: `lib/account-kind.ts`.
 * Static segment beside `api/accounts/[id]` — Next resolves static first (CLAUDE.md, behaviour 6).
 */

import { requirePlatformStaff } from '@/lib/session';
import { listAccountKinds, normaliseKindKey, parseKind, setAccountKind } from '@/lib/account-kind';
import { logSecurityEvent } from '@/lib/audit';
import { ACCOUNT_KINDS } from '@/lib/account-kind-key';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { error } = await requirePlatformStaff();
  if (error) return error;
  return Response.json({ kinds: await listAccountKinds() });
}

export async function PUT(req: Request) {
  const { user, error } = await requirePlatformStaff();
  if (error) return error;
  const body = (await req.json().catch(() => ({}))) as { tenant?: unknown; kind?: unknown };
  const tenant = typeof body.tenant === 'string' ? normaliseKindKey(body.tenant) : '';
  const kind = parseKind(body.kind);
  if (!tenant || tenant.length > 120 || !/^[a-z0-9._ -]+$/.test(tenant)) {
    return Response.json({ detail: 'Missing or invalid: tenant' }, { status: 400 });
  }
  if (!kind) return Response.json({ detail: `kind must be one of: ${ACCOUNT_KINDS.map((k) => k.key).join(', ')}` }, { status: 400 });
  try {
    await setAccountKind(tenant, kind, user.email);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const missing = /platform_settings|42P01|PGRST205/i.test(msg);
    return Response.json(
      { detail: missing ? 'The master database has no platform_settings table — run sql/008_platform_settings.sql first.' : msg },
      { status: missing ? 409 : 502 },
    );
  }
  await logSecurityEvent('account_kind_changed', { user, accountName: tenant, detail: { tenant, kind } });
  return Response.json({ ok: true, tenant, kind });
}
