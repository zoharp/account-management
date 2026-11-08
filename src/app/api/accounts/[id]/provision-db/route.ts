/**
 * POST /api/accounts/:id/provision-db — create an Ask Paul database for an
 * EXISTING account that has none, and attach it to that account.
 *
 * Why this exists: `POST /api/accounts` with `provision: true` can only INSERT
 * a new account row, so the Ask Paul tab offered "Create Ask Paul database"
 * only to traceability-only tenants. An account with a master row but no
 * database (e.g. reutsapir, EU, 2026-11-08) got only the manual Vector DB form.
 *
 * Returns the same job as the create path; the client drives it with
 * `POST /api/accounts/provision/:jobId` exactly as before. The region is the
 * account's own row value — never the client's — so the project is created
 * where the account already lives.
 */

import { requirePlatformStaff } from '@/lib/session';
import { accountCiFilter, pgGet } from '@/lib/supabase';
import { logSecurityEvent } from '@/lib/audit';
import { hasAskPaulDatabase } from '@/lib/modules';
import { coerceRegion } from '@/lib/regions';
import {
  findResumableJob,
  ProvisioningError,
  retryProvisioning,
  startAttachProvisioning,
  toJobView,
} from '@/lib/provisioning';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const { user, error } = await requirePlatformStaff();
  if (error) return error;

  const { id } = await ctx.params;
  const rows = await pgGet<
    Array<{ id: string; account_name: string; region: string | null; db_host: string | null; vector_db_host: string | null }>
  >(`accounts?id=eq.${encodeURIComponent(id)}&select=id,account_name,region,db_host,vector_db_host`);
  const account = rows[0];
  if (!account) return Response.json({ detail: 'Account not found' }, { status: 404 });
  if (hasAskPaulDatabase(account)) {
    return Response.json(
      { detail: `'${account.account_name}' already has a database.` },
      { status: 409 },
    );
  }

  const inFlight = await pgGet<Array<{ id: string; state: string }>>(
    `account_provisioning?account_name=${accountCiFilter(account.account_name)}` +
      `&state=not.in.(done,error)&select=id,state`,
  );
  if (inFlight.length) {
    return Response.json(
      {
        detail:
          `A database for '${account.account_name}' is already being created ` +
          `(job ${inFlight[0].id}, at '${inFlight[0].state}').`,
      },
      { status: 409 },
    );
  }

  const region = coerceRegion(account.region);

  try {
    // A failed earlier attempt already made (and is billing) a project — finish
    // that one instead of asking Supabase for a second with the same name.
    const resumable = await findResumableJob(account.account_name);
    if (resumable) {
      const attachTo = (resumable.payload as { attach_account_id?: string } | null)?.attach_account_id;
      if (attachTo !== account.id) {
        return Response.json(
          {
            detail:
              `An earlier create for '${account.account_name}' left Supabase project ` +
              `${resumable.project_ref} behind (job ${resumable.id}). Delete it in Supabase or ` +
              `finish it from Create account before starting another.`,
          },
          { status: 409 },
        );
      }
      const job = await retryProvisioning(resumable.id);
      await logSecurityEvent('account_provisioning_retried', {
        user,
        accountName: account.account_name,
        detail: { job_id: job.id, project_ref: job.project_ref, resumed_at: job.state, region, attach: true },
      });
      return Response.json({ job: toJobView(job) }, { status: 202 });
    }

    const job = await startAttachProvisioning(
      { id: account.id, account_name: account.account_name, region },
      user.email,
    );
    await logSecurityEvent('account_provisioning_started', {
      user,
      accountName: account.account_name,
      detail: { job_id: job.id, project_ref: job.project_ref, region, attach: true },
    });
    return Response.json({ job: toJobView(job) }, { status: 202 });
  } catch (e) {
    if (e instanceof ProvisioningError) {
      return Response.json({ detail: e.message }, { status: 409 });
    }
    return Response.json({ detail: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
