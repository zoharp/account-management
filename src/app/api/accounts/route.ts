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
import { orcanosVirtualDirFromUrl } from '@/lib/orcanos-url';
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

  const accounts = await pgGet<AccountListRow[]>(
    'accounts?select=id,account_name,db_type,is_active,created_at,orcanos_api_url' +
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
      is_active: true,
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

    await logSecurityEvent('account_created', {
      user,
      accountName,
      detail: { account_id: created?.id, provisioned: false, modules },
    });

    // The licences live in the traceability instance, which shares no
    // transaction with master. Master is written first (above) and a failure
    // here is reported as a partial success naming which half landed — the same
    // contract as the module pills (see INTERNAL_TRACE_MERGE.md §4.4).
    const anyModule = Object.values(modules).some((v) => v !== undefined);
    if (anyModule) {
      // `account_access` is keyed on the Orcanos tenant, not on the master
      // account name. Derive it from the REST API URL when there is one; fall
      // back to the account name, which is what the 2026-08-29 rename made true
      // for every existing account.
      const tenant = orcanosVirtualDirFromUrl(payload.orcanos_api_url || '') || accountName;
      try {
        await upsertTraceModules(tenant, modules);
      } catch (e) {
        return Response.json(
          {
            account: created,
            detail:
              `Account '${accountName}' was created, but its module licences were not saved ` +
              `(tenant '${tenant}'): ${e instanceof Error ? e.message : String(e)}. ` +
              `Set them from the account's Traceability dialog.`,
          },
          { status: 502 },
        );
      }
    }

    return Response.json({ account: created }, { status: 201 });
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
