/**
 * The traceability-matrix per-account settings, proxied.
 *
 *   GET    — the tenant's allowlist row + the AI engine catalog
 *   PUT    — save the access flags, module licences and note
 *   DELETE — remove the tenant from the allowlist
 *
 * Everything here is a thin, authenticated pass-through to that app's
 * `/api/admin/*`. It is deliberately a proxy and not a reimplementation: the
 * trace app owns its SQLite (single writer, see its Critical Note #17) and owns
 * the meaning of these flags. What this layer adds is the platform staff gate,
 * the master audit trail, and the two invariants below that its own admin page
 * enforces only in the browser.
 *
 * Sits beside the dynamic `api/accounts/[id]` — `trace` is a static segment and
 * Next resolves those first (CLAUDE.md, "Route precedence").
 */

import { requirePlatformStaff } from '@/lib/session';
import { logSecurityEvent } from '@/lib/audit';
import { pgGet } from '@/lib/supabase';
import {
  askPaulDatabaseExists,
  hasAskPaulDatabase,
  tenantOf,
  ASK_PAUL_NEEDS_DB,
} from '@/lib/modules';
import {
  deleteTraceAccount,
  getTraceEngine,
  listTraceAccounts,
  saveTraceAccount,
  supportsModules,
  traceConfigured,
  TraceApiError,
  type TraceAccountRow,
} from '@/lib/trace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function notConnected() {
  return Response.json(
    { detail: 'Traceability is not connected (TRACE_API_URL / TRACE_ADMIN_PASSWORD).' },
    { status: 503 },
  );
}

function failed(e: unknown) {
  const status = e instanceof TraceApiError ? e.status : 500;
  return Response.json(
    { detail: e instanceof Error ? e.message : String(e) },
    // A 401 from the trace API is OUR misconfiguration, not the caller's.
    { status: status === 401 ? 502 : status },
  );
}

export async function GET(_req: Request, ctx: { params: Promise<{ tenant: string }> }) {
  const { error } = await requirePlatformStaff();
  if (error) return error;
  if (!traceConfigured()) return notConnected();

  const { tenant } = await ctx.params;
  const name = tenant.toLowerCase();

  try {
    const rows = await listTraceAccounts();
    const row = rows.find((r) => r.account.toLowerCase() === name) ?? null;

    // The catalog is what makes the provider/model pickers real rather than a
    // hardcoded guess that drifts from ai_provider.py. A failure is not fatal —
    // the flags half of the screen is still usable without it.
    let engine = null;
    try {
      engine = await getTraceEngine();
    } catch (e) {
      console.error(`[GET /api/accounts/trace/${name}] engine catalog failed:`, e);
    }

    // What this tenant is called in the master DB — i.e. the value QMS AI's
    // `X-Account` header carries and `account_llm_keys` is keyed on. The trace
    // app stores its own copy in `ask_paul_account` because it cannot see the
    // master DB; this console can see both, so it is the only place the two can
    // actually be checked against each other. Non-fatal if it fails.
    let masterAccountName: string | null = null;
    // Whether that master account has a vector database, which is what decides
    // if Ask Paul may be licensed at all (`ASK_PAUL_NEEDS_DB`). Read here rather
    // than in the browser: the hosts never need to leave the server.
    let masterHasDatabase = false;
    try {
      const masters = await pgGet<
        Array<{
          account_name: string;
          orcanos_api_url: string | null;
          db_host: string | null;
          vector_db_host: string | null;
        }>
      >('accounts?select=account_name,orcanos_api_url,db_host,vector_db_host');
      const master = masters.find((m) => tenantOf(m) === name) ?? null;
      masterAccountName = master?.account_name ?? null;
      masterHasDatabase = master ? hasAskPaulDatabase(master) : false;
    } catch (e) {
      console.error(`[GET /api/accounts/trace/${name}] master name lookup failed:`, e);
    }

    return Response.json({
      tenant: name,
      row,
      engine,
      master_account_name: masterAccountName,
      master_has_database: masterHasDatabase,
      supports_modules: supportsModules(rows),
    });
  } catch (e) {
    return failed(e);
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ tenant: string }> }) {
  const { user, error } = await requirePlatformStaff();
  if (error) return error;
  if (!traceConfigured()) return notConnected();

  const { tenant } = await ctx.params;
  const name = tenant.toLowerCase();
  const body = (await req.json().catch(() => ({}))) as Partial<Record<string, unknown>>;

  const flag = (key: string, fallback: number): number => {
    const v = body[key];
    return v === undefined ? fallback : v ? 1 : 0;
  };

  try {
    const rows = await listTraceAccounts();
    const current = rows.find((r) => r.account.toLowerCase() === name);
    const creating = !current;

    if (!supportsModules(rows) && (body.allow_trace !== undefined || body.allow_training !== undefined)) {
      // Writing a module flag to an instance that has no such column succeeds
      // and drops it, because the trace API rewrites the whole row from a
      // pydantic model that has never heard of it. Refuse rather than report a
      // save that did not happen.
      return Response.json(
        {
          detail:
            'This traceability instance predates per-module licences and would silently ' +
            'discard the change. Deploy traceability-matrix 3.23.0 first.',
        },
        { status: 409 },
      );
    }

    // A row this app has never seen starts from the trace API's own defaults,
    // which are the fail-open ones. Everything else starts from what is stored.
    const base: TraceAccountRow = current ?? {
      account: name,
      allow_access: 1,
      allow_ai: 0,
      allow_add: 1,
      allow_trace: 1,
      allow_training: 1,
      allow_ask_paul: 1,
      ask_paul_account: '',
      note: '',
    };

    const changes: Partial<TraceAccountRow> = {
      allow_access: flag('allow_access', base.allow_access),
      allow_ai: flag('allow_ai', base.allow_ai),
      allow_add: flag('allow_add', base.allow_add ?? 1),
      allow_trace: flag('allow_trace', base.allow_trace ?? 1),
      allow_training: flag('allow_training', base.allow_training ?? 1),
      allow_ask_paul: flag('allow_ask_paul', base.allow_ask_paul ?? 1),
      note: typeof body.note === 'string' ? body.note : (base.note ?? ''),
    };
    if (typeof body.ask_paul_account === 'string') {
      changes.ask_paul_account = body.ask_paul_account.trim();
    }

    const next = { ...base, ...changes };

    // Same rule as the create form and the list pill: Ask Paul is the one module
    // with a per-tenant database and cannot be licensed without one. Checked only
    // when this save turns it ON — a tenant that already holds the flag can
    // always be saved, and turning it off must never be blocked.
    const askPaulWasOn = creating ? false : Boolean(base.allow_ask_paul ?? 1);
    if (next.allow_ask_paul && !askPaulWasOn) {
      if (!(await askPaulDatabaseExists({ tenant: name }))) {
        return Response.json({ detail: ASK_PAUL_NEEDS_DB }, { status: 409 });
      }
    }

    // The trace admin page refuses this in the browser and the API does not
    // check it at all, so it has to be enforced here too: an account with no
    // module can sign in and reach nothing, which looks like a broken app
    // rather than a licensing decision.
    if (!next.allow_trace && !next.allow_training) {
      return Response.json(
        { detail: 'An account needs at least one module — Traceability or Training.' },
        { status: 400 },
      );
    }

    await saveTraceAccount(base, changes);
    await logSecurityEvent(creating ? 'trace_account_created' : 'trace_account_updated', {
      user,
      accountName: name,
      detail: { ...next, note: undefined },
    });
    return Response.json({ ok: true, tenant: name, row: next as TraceAccountRow });
  } catch (e) {
    return failed(e);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ tenant: string }> }) {
  const { user, error } = await requirePlatformStaff();
  if (error) return error;
  if (!traceConfigured()) return notConnected();

  const { tenant } = await ctx.params;
  const name = tenant.toLowerCase();

  try {
    await deleteTraceAccount(name);
    await logSecurityEvent('trace_account_deleted', { user, accountName: name });
    return Response.json({
      ok: true,
      // Same consequence the trace admin page warns about in its confirm dialog.
      // It costs nothing to repeat and it is the part people forget.
      warning: `Anyone signed in to traceability from '${name}' will be signed out on their next action.`,
    });
  } catch (e) {
    return failed(e);
  }
}
