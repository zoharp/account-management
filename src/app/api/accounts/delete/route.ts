/**
 * POST /api/accounts/delete — delete an account and EVERYTHING it owns.
 *
 * Body: `{ account_id: string | null, tenant: string | null, confirm: "DELETE" }`
 *
 * `DELETE /api/accounts/:id` removes only the master record and leaves the
 * traceability tenant and the Supabase project behind (CLAUDE.md, behaviour #8).
 * This route is the "remove the customer" act, in this order:
 *
 *   1. traceability — purge every tenant row in the region that holds it
 *      (panels, users, quiz attempts, `account_access`, AI config), then the
 *      residency signpost in every region
 *   2. Supabase — delete the account's own project (the Ask Paul vector DB),
 *      plus any project a failed provisioning job left behind under its name
 *   3. master — `account_llm_keys`, `auth_methods`, `account_usage_logs`,
 *      `account_provisioning`, and the `accounts` row LAST
 *
 * The `accounts` row goes last so a failure part-way leaves the account in the
 * list and the operator can simply run the delete again; every step treats
 * "already gone" as done. The run stops at the first failure.
 *
 * NOT deleted, on purpose:
 *  - `security_audit_log` — the audit trail is evidence (ISO 27001 A.8.15) and
 *    must outlive what it describes. The delete itself is recorded there.
 *  - `users` — global across accounts, one row per person, not per tenant.
 *
 * Refused outright:
 *  - the `PLATFORM_ACCOUNT` — its `auth_methods` row is the console's login screen
 *  - a Supabase project that is the master, or that another account points at
 *  - a tenant another master account also resolves to
 *  - a tenant that does not match the one the server derives for the account,
 *    so a stale or tampered client cannot aim the purge at someone else
 */

import { requirePlatformStaff } from '@/lib/session';
import { accountCiFilter, pgDelete, pgGet } from '@/lib/supabase';
import { logSecurityEvent } from '@/lib/audit';
import { platformAccount, supabaseUrl } from '@/lib/env';
import { traceTenantForAccount } from '@/lib/orcanos-url';
import { deleteSupabaseProject, projectRefFromHost } from '@/lib/provisioning';
import {
  deleteRegionDirectory,
  findTraceAccount,
  purgeTenant,
  traceConfigured,
} from '@/lib/trace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface MasterRow {
  id: string;
  account_name: string;
  orcanos_api_url: string | null;
  vector_db_host: string | null;
  db_host: string | null;
}

interface DeleteStep {
  step: string;
  ok: boolean;
  detail: string;
}

const lc = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

export async function POST(req: Request) {
  const { user, error } = await requirePlatformStaff();
  if (error) return error;

  const body = (await req.json().catch(() => ({}))) as {
    account_id?: string | null;
    tenant?: string | null;
    confirm?: string;
  };

  // The typed word is checked here too — the button being disabled is UX, not a boundary.
  if (body.confirm !== 'DELETE') {
    return Response.json({ detail: 'Type DELETE to confirm.' }, { status: 400 });
  }

  const accountId = body.account_id?.trim() || null;
  let tenant = body.tenant?.trim() || null;
  if (!accountId && !tenant) {
    return Response.json({ detail: 'Nothing to delete.' }, { status: 400 });
  }

  // ── Resolve and refuse ──────────────────────────────────────────────────
  const all = await pgGet<MasterRow[]>(
    'accounts?select=id,account_name,orcanos_api_url,vector_db_host,db_host',
  );
  const account = accountId ? all.find((r) => r.id === accountId) ?? null : null;
  if (accountId && !account) {
    return Response.json({ detail: 'Account not found' }, { status: 404 });
  }
  const others = all.filter((r) => r.id !== accountId);
  const tenantOf = (r: MasterRow) =>
    lc(traceTenantForAccount({ orcanosApiUrl: r.orcanos_api_url, accountName: r.account_name }).tenant);

  if (account) {
    const derived = tenantOf(account);
    if (tenant && lc(tenant) !== derived) {
      return Response.json(
        {
          detail:
            `The tenant sent (${tenant}) is not the one this account resolves to (${derived}). ` +
            'Reload the list and try again.',
        },
        { status: 409 },
      );
    }
    tenant = derived;
  }

  const platform = lc(platformAccount());
  if (lc(account?.account_name) === platform || lc(tenant) === platform) {
    return Response.json(
      {
        detail:
          `'${platformAccount()}' is the platform account — its sign-in methods are this console's ` +
          'login screen. It cannot be deleted from here.',
      },
      { status: 409 },
    );
  }

  if (tenant) {
    const sharing = others.filter((r) => tenantOf(r) === lc(tenant));
    if (sharing.length) {
      return Response.json(
        {
          detail:
            `Traceability tenant '${tenant}' is also used by ${sharing
              .map((r) => r.account_name)
              .join(', ')}. Deleting it would wipe that account's data too.`,
        },
        { status: 409 },
      );
    }
  }

  // Supabase projects: the account's own, plus orphans from failed provisioning jobs.
  const masterRef = projectRefFromHost(supabaseUrl());
  const refs = new Set<string>();
  for (const h of [account?.vector_db_host, account?.db_host]) {
    const ref = projectRefFromHost(h);
    if (ref) refs.add(ref);
  }
  const name = account?.account_name ?? null;
  if (name) {
    const jobs = await pgGet<Array<{ project_ref: string | null }>>(
      `account_provisioning?account_name=${accountCiFilter(name)}&project_ref=not.is.null&select=project_ref`,
    );
    for (const j of jobs) if (j.project_ref) refs.add(j.project_ref.toLowerCase());
  }
  const protectedRefs = new Set<string>(
    others
      .flatMap((r) => [projectRefFromHost(r.vector_db_host), projectRefFromHost(r.db_host)])
      .filter((r): r is string => Boolean(r)),
  );
  if (masterRef) protectedRefs.add(masterRef);
  const skipped = [...refs].filter((r) => protectedRefs.has(r));
  const projects = [...refs].filter((r) => !protectedRefs.has(r));

  // ── Delete ──────────────────────────────────────────────────────────────
  const steps: DeleteStep[] = [];
  let failed = false;
  const run = async (step: string, fn: () => Promise<string>) => {
    if (failed) return;
    try {
      steps.push({ step, ok: true, detail: await fn() });
    } catch (e) {
      failed = true;
      steps.push({ step, ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
  };

  if (tenant && traceConfigured()) {
    const t = tenant;
    await run('Traceability data', async () => {
      const row = await findTraceAccount(t);
      if (!row?.region) return `tenant '${t}' is not in any traceability instance — nothing to purge`;
      const purged = await purgeTenant(t, row.region);
      return `purged ${purged.total_rows} rows from ${row.region.toUpperCase()}`;
    });
    await run('Region directory', async () => {
      const { failed: f } = await deleteRegionDirectory(t);
      if (f.length) throw new Error(`could not remove the entry on ${f.join(', ').toUpperCase()}`);
      return 'removed from every region';
    });
  } else if (tenant) {
    await run('Traceability data', async () => {
      throw new Error('Traceability is not configured on this deployment, so its data cannot be removed.');
    });
  }

  for (const ref of projects) {
    await run(`Supabase project ${ref}`, async () =>
      (await deleteSupabaseProject(ref)) ? 'deleted' : 'already gone',
    );
  }

  if (name) {
    const filter = `?account_name=${accountCiFilter(name)}`;
    for (const table of ['account_llm_keys', 'auth_methods', 'account_usage_logs', 'account_provisioning']) {
      await run(table, async () => {
        await pgDelete(`${table}${filter}`);
        return 'deleted';
      });
    }
  }
  if (accountId) {
    await run('Account record', async () => {
      await pgDelete(`accounts?id=eq.${encodeURIComponent(accountId)}`);
      return 'deleted';
    });
  }

  await logSecurityEvent('account_purged', {
    user,
    accountName: name ?? tenant,
    success: !failed,
    detail: { account_id: accountId, tenant, projects, projects_kept: skipped, steps },
  });

  return Response.json(
    {
      success: !failed,
      steps,
      ...(skipped.length && {
        warning:
          `Supabase project ${skipped.join(', ')} was kept: another account (or the master) uses it.`,
      }),
    },
    { status: failed ? 502 : 200 },
  );
}
