/**
 * GET  /api/accounts/provision/:jobId — current state of a provisioning job.
 * POST /api/accounts/provision/:jobId — advance the job by exactly one step.
 *
 * The client polls POST every few seconds until the job reaches `done` or
 * `error`. Each call does one bounded unit of work, so no single request has to
 * outlive a serverless function; see the header comment in lib/provisioning.ts
 * for why the streaming design in the QMS backend was replaced.
 *
 * `running_schema` is the long step — it executes the whole bootstrap file over
 * one Postgres connection — hence the raised maxDuration.
 */

import { requirePlatformStaff } from '@/lib/session';
import { getJob, tickProvisioning, toJobView } from '@/lib/provisioning';
import { pgGet } from '@/lib/supabase';
import { logSecurityEvent } from '@/lib/audit';
import type { AccountListRow } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Ctx = { params: Promise<{ jobId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { error } = await requirePlatformStaff();
  if (error) return error;

  const { jobId } = await ctx.params;
  const job = await getJob(jobId);
  if (!job) return Response.json({ detail: 'Provisioning job not found' }, { status: 404 });

  return Response.json({ job: toJobView(job) });
}

export async function POST(_req: Request, ctx: Ctx) {
  const { user, error } = await requirePlatformStaff();
  if (error) return error;

  const { jobId } = await ctx.params;

  const before = await getJob(jobId);
  if (!before) return Response.json({ detail: 'Provisioning job not found' }, { status: 404 });

  const job = await tickProvisioning(jobId);

  // Audit the terminal transitions once, on the tick that causes them.
  if (before.state !== 'done' && job.state === 'done') {
    await logSecurityEvent('account_created', {
      user,
      accountName: job.account_name,
      detail: { account_id: job.account_id, project_ref: job.project_ref, job_id: job.id },
    });
  } else if (before.state !== 'error' && job.state === 'error') {
    await logSecurityEvent('account_provisioning_failed', {
      user,
      accountName: job.account_name,
      detail: { project_ref: job.project_ref, job_id: job.id, message: job.message },
      success: false,
    });
  }

  // On completion hand back the account row so the list can be updated without
  // a second round trip, matching the QMS `account_created` event.
  let account: AccountListRow | null = null;
  if (job.state === 'done' && job.account_id) {
    const rows = await pgGet<AccountListRow[]>(
      `accounts?id=eq.${encodeURIComponent(job.account_id)}` +
        `&select=id,account_name,db_type,is_active,created_at`,
    );
    if (rows[0]) account = { ...rows[0], total_cost_usd: 0, total_tokens: 0 };
  }

  return Response.json({ job: toJobView(job), account });
}
