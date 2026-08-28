/**
 * GET  /api/accounts  — the account list, with cost totals.
 * POST /api/accounts  — start provisioning a new account (returns a job).
 *
 * Ports `GET /admin/accounts` and `POST /admin/accounts` from backend/api.py.
 * Both answer 404 to a non-staff caller — see `requirePlatformStaff`.
 */

import { requirePlatformStaff } from '@/lib/session';
import { accountCiFilter, pgGet, pgRpc } from '@/lib/supabase';
import { encryptSecret } from '@/lib/crypto';
import { normalizeOrcanosUrl } from '@/lib/orcanos';
import { startProvisioning, toJobView } from '@/lib/provisioning';
import { logSecurityEvent } from '@/lib/audit';
import type { AccountListRow } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CostTotal {
  account_id: string;
  total_cost_usd: number | string | null;
  total_tokens: number | string | null;
}

export async function GET() {
  const { user, error } = await requirePlatformStaff();
  if (error) return error;
  void user;

  const accounts = await pgGet<AccountListRow[]>(
    'accounts?select=id,account_name,db_type,is_active,created_at&order=account_name.asc',
  );

  // The RPC aggregates every account in one call. A failure here must not blank
  // the list — the QMS version swallows it the same way and shows zeros.
  let totalsById = new Map<string, CostTotal>();
  try {
    const totals = await pgRpc<CostTotal[]>('account_cost_totals', {});
    totalsById = new Map((totals ?? []).map((t) => [t.account_id, t]));
  } catch (e) {
    console.error('[GET /api/accounts] cost totals lookup failed:', e);
  }

  for (const acct of accounts) {
    const t = totalsById.get(acct.id);
    acct.total_cost_usd = Math.round(Number(t?.total_cost_usd ?? 0) * 1e6) / 1e6;
    acct.total_tokens = Number(t?.total_tokens ?? 0) || 0;
  }

  return Response.json({ accounts });
}

export async function POST(req: Request) {
  const { user, error } = await requirePlatformStaff();
  if (error) return error;

  const body = (await req.json().catch(() => ({}))) as Record<string, string | undefined>;
  const accountName = (body.account_name ?? '').trim();
  if (!accountName) return Response.json({ detail: 'Missing: account_name' }, { status: 400 });

  const existing = await pgGet<Array<{ id: string }>>(
    `accounts?account_name=${accountCiFilter(accountName)}&select=id`,
  );
  if (existing.length) {
    return Response.json({ detail: `Account '${accountName}' already exists` }, { status: 409 });
  }

  // Any secret typed into the create form is encrypted before it is persisted
  // on the job row, so plaintext never rests anywhere.
  const payload: Record<string, string> = {
    orcanos_db_host: (body.orcanos_db_host ?? '').trim(),
    orcanos_db_name: (body.orcanos_db_name ?? '').trim(),
    orcanos_db_user: (body.orcanos_db_user ?? '').trim(),
    orcanos_api_url: body.orcanos_api_url ? normalizeOrcanosUrl(body.orcanos_api_url) : '',
    orcanos_username: (body.orcanos_username ?? '').trim(),
  };
  if (body.orcanos_db_password) {
    payload.orcanos_db_password_encrypted = encryptSecret(body.orcanos_db_password);
  }
  if (body.orcanos_api_password) {
    payload.orcanos_api_password_encrypted = encryptSecret(body.orcanos_api_password);
  }

  try {
    const job = await startProvisioning(accountName, payload, user.email);
    await logSecurityEvent('account_provisioning_started', {
      user,
      accountName,
      detail: { job_id: job.id, project_ref: job.project_ref },
    });
    return Response.json({ job: toJobView(job) }, { status: 202 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // The most common cause by far is the migration not having been applied.
    if (/account_provisioning/.test(message)) {
      return Response.json(
        {
          detail:
            'The account_provisioning table is missing. Run sql/001_account_provisioning.sql ' +
            'against the master database, then try again.',
        },
        { status: 500 },
      );
    }
    return Response.json({ detail: message }, { status: 500 });
  }
}
