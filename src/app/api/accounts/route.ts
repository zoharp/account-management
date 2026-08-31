/**
 * GET  /api/accounts  — the account list, with cost totals.
 * POST /api/accounts  — start provisioning a new account (returns a job).
 *
 * Ports `GET /admin/accounts` and `POST /admin/accounts` from backend/api.py.
 * Both answer 404 to a non-staff caller — see `requirePlatformStaff`.
 */

import { requirePlatformStaff } from '@/lib/session';
import { accountCiFilter, pgGet, pgPost, pgRpc } from '@/lib/supabase';
import { encryptSecret } from '@/lib/crypto';
import { normalizeOrcanosUrl } from '@/lib/orcanos';
import { traceTenantForAccount } from '@/lib/orcanos-url';
import { startProvisioning, toJobView } from '@/lib/provisioning';
import { logSecurityEvent } from '@/lib/audit';
import { mergeAccounts } from '@/lib/modules';
import {
  listTraceAccounts,
  supportsAskPaul,
  supportsModules,
  traceConfigured,
  upsertTraceModules,
  type TraceAccountRow,
} from '@/lib/trace';
import type { AccountListRow, ModuleKey, TraceSourceStatus } from '@/lib/types';

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

  // `db_host` and `vector_db_host` are read only to answer "does this account
  // have a database at all" — `mergeAccounts` reduces them to `has_database` and
  // neither host reaches the browser. Both are non-secret regardless.
  const accounts = await pgGet<AccountListRow[]>(
    'accounts?select=id,account_name,db_type,db_host,vector_db_host,is_active,created_at,orcanos_api_url' +
      '&order=account_name.asc',
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

  // The traceability half. Treated exactly like the cost RPC above: a failure
  // degrades the list to its QMS AI half rather than failing the page. The two
  // systems are independent and one being down is not an outage of the other.
  let traceRows: TraceAccountRow[] = [];
  const trace: TraceSourceStatus = {
    available: false,
    supports_modules: false,
    supports_ask_paul: false,
    url: process.env.TRACE_API_URL ?? null,
    message: '',
  };

  if (!traceConfigured()) {
    trace.message =
      'Traceability is not connected. Set TRACE_API_URL and TRACE_ADMIN_PASSWORD to merge its accounts.';
  } else {
    try {
      traceRows = await listTraceAccounts();
      trace.available = true;
      trace.supports_modules = supportsModules(traceRows);
      trace.supports_ask_paul = supportsAskPaul(traceRows);
      if (!trace.supports_modules) {
        // Production Fly is 3.21.0 and has no allow_trace / allow_training.
        // `moduleFlag()` reads their absence as licensed (fail-open, matching
        // access_control._modules_of), so say so rather than showing ticks that
        // look like stored decisions.
        trace.message =
          'This traceability instance predates per-module licences (needs 3.23.0) — ' +
          'every module shows as licensed for every listed account.';
      } else if (!trace.supports_ask_paul) {
        // 3.23–3.26: the other two columns are real, allow_ask_paul is not.
        trace.message =
          'This traceability instance predates the Ask Paul licence (needs 3.27.0) — ' +
          'Ask Paul shows as licensed for every listed account.';
      }
    } catch (e) {
      trace.message = e instanceof Error ? e.message : String(e);
      console.error('[GET /api/accounts] traceability lookup failed:', e);
    }
  }

  return Response.json({
    accounts: mergeAccounts(accounts, traceRows, { traceAvailable: trace.available }),
    trace,
  });
}

export async function POST(req: Request) {
  const { user, error } = await requirePlatformStaff();
  if (error) return error;

  const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const body = raw as Record<string, string | undefined>;
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

  // ── No-database accounts ────────────────────────────────────────────────
  //
  // Provisioning a Supabase project is only needed by **Ask Paul**, which is
  // the one module with a per-tenant vector database. Traceability and Training
  // read from the traceability instance's own SQLite and need nothing here, so
  // requiring a database to create an account made every account wait on the
  // slowest, most failure-prone step for a capability most of them do not use.
  //
  // This path writes the master row directly and licences the modules. The
  // database can be added later — `PATCH /api/accounts/:id` already edits every
  // vector column, and Ask Paul stays unlicensed until it is.
  const provision = raw.provision === true || raw.provision === 'true';
  const modules = (raw.modules ?? {}) as Partial<Record<ModuleKey, boolean>>;

  // Ask Paul is the one module that needs the database, so licensing it on an
  // account that will not have one produces a hand-off into an app with nothing
  // behind it. The form disables the tick; this is the boundary that enforces it.
  if (modules.ask_paul && !provision) {
    return Response.json(
      {
        detail:
          'Ask Paul cannot be licensed for an account with no database. Tick ' +
          '“Provision a dedicated Supabase database”, or create the account without ' +
          'Ask Paul and license it once its database exists.',
      },
      { status: 400 },
    );
  }

  if (!provision) {
    // `accounts` inherits four NOT NULL columns with no default from QMS —
    // `db_type`, `db_name`, `db_user`, `db_password_encrypted` — the legacy
    // half of the vector-DB pair. The provisioning path fills them from the
    // project it just created; an account with no database has nothing to put
    // there, and omitting them is a 23502 not_null_violation.
    //
    // Empty string, not a sentinel, and deliberately not a schema change:
    // `accounts` is shared with the running QMS, and this codebase already
    // treats an empty secret as "not configured" (`orcanosTestLogin` returns
    // `{success: null}` on one, which renders as a neutral note rather than a
    // failure). A sentinel like 'none' would have to be taught to every reader.
    // Making the columns nullable is the cleaner fix and needs QMS to agree.
    const row: Record<string, unknown> = {
      account_name: accountName,
      // NOT active. `is_active` is Ask Paul's kill switch and nothing else reads
      // it (lib/modules.ts), so creating a database-less account active would
      // switch on half of the very licence this route refuses above. It flips
      // when the account gets a database and Ask Paul is licensed — from the
      // pill, or from the Status switch in the account editor.
      is_active: false,
      db_type: '',
      db_name: '',
      db_user: '',
      db_password_encrypted: '',
    };
    // Only non-empty values from the form: writing '' over a supplied value
    // would blank it, and the UI reads '' as "configured, empty".
    for (const [k, v] of Object.entries(payload)) if (v) row[k] = v;

    let created: { id: string; account_name: string };
    try {
      const inserted = await pgPost<Array<{ id: string; account_name: string }>>('accounts', row);
      created = inserted[0];
    } catch (e) {
      return Response.json(
        { detail: `Could not create the account: ${e instanceof Error ? e.message : String(e)}` },
        { status: 500 },
      );
    }

    // `account_access` is keyed on the Orcanos tenant, not on the master account
    // name — `traceTenantForAccount` decides which and says how.
    const { tenant, from } = traceTenantForAccount({
      orcanosApiUrl: payload.orcanos_api_url,
      accountName,
    });

    await logSecurityEvent('account_created', {
      user,
      accountName,
      detail: { account_id: created?.id, provisioned: false, modules, tenant, tenant_from: from },
    });

    // The allowlist row is written even when no module was ticked, and this is
    // the whole point: it is the ONLY row a tenant can get from this console.
    // `PUT /api/accounts/modules` used to 404 on a tenant with no row, so an
    // account created without one was unreachable in traceability and could not
    // be fixed from here — it had to be added on the trace instance's own
    // /admin page. A row with every module at 0 is licensed for nothing, which
    // is exactly what an untouched create form means, and is one pill click
    // away from being useful.
    //
    // The licences live in the traceability instance, which shares no
    // transaction with master. Master is written first (above) and a failure
    // here is reported as a partial success naming which half landed — the same
    // contract as the module pills (see INTERNAL_TRACE_MERGE.md §4.4).
    try {
      await upsertTraceModules(tenant, modules);
    } catch (e) {
      return Response.json(
        {
          account: created,
          detail:
            `Account '${accountName}' was created, but its traceability allowlist entry was ` +
            `not written (tenant '${tenant}'): ${e instanceof Error ? e.message : String(e)}. ` +
            `Until it exists this tenant cannot sign in to traceability — retry from the ` +
            `account's module pills.`,
        },
        { status: 502 },
      );
    }

    return Response.json({ account: created, tenant, tenant_from: from }, { status: 201 });
  }

  try {
    // The licences ride along on the job row and are written by its final step,
    // after the `accounts` row exists. Writing them here instead would licence a
    // tenant whose provisioning may still fail — and Ask Paul, the only module
    // that can be ticked on this path, is exactly the one that would then point
    // at a database that was never created.
    const job = await startProvisioning(accountName, { ...payload, modules }, user.email);
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
