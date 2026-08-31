/**
 * The merged account list — master Supabase (accounts, spend) unioned with the
 * traceability-matrix allowlist (every module licence).
 *
 * ## Why a union and not a join
 *
 * The two lists barely overlap. Master `accounts` holds the tenants QMS AI has
 * been provisioned for (3 today); the trace app's `account_access` holds every
 * Orcanos tenant allowed to sign in to it (15 today). Only 3 are in both. So
 * "present in one, absent in the other" is the NORMAL case, not an error, and
 * every consumer has to render it — hence `boolean | null` on each module
 * rather than a plain boolean.
 *
 * ## The merge key
 *
 * The Orcanos tenant (`Virtual_dir`), lower-cased. NOT `account_name`: the
 * master account labelled "Medical Portal" is tenant `orca60`, and "demo" is
 * `orcanosdemo`. The only reliable source on the master side is the tenant
 * segment of `orcanos_api_url`, which is what `orcanosVirtualDirFromUrl()`
 * extracts and what `access_control.account_from_url()` extracts on the Python
 * side — the two agree by construction.
 *
 * A master row with no `orcanos_api_url` has no tenant and therefore cannot be
 * matched. It still appears, with its traceability half blank. A dedicated
 * `accounts.orcanos_tenant` column is the fix and is planned; deriving it keeps
 * this read-only for now.
 *
 * ## Where each licence lives
 *
 * Each module's licence lives where that module's runtime reads it — there is
 * no central table and deliberately no sync:
 *
 *   ask_paul  → trace `account_access.allow_ask_paul`  (gates the SSO handoff)
 *   trace     → trace `account_access.allow_trace`     (read at login by access_control)
 *   training  → trace `account_access.allow_training`  (ditto)
 *
 * ## Why Ask Paul and not "QMS AI"
 *
 * They are the same product: `ask_paul_account` on the trace side holds what a
 * tenant is called INSIDE Ask Paul, which is its master `accounts.account_name`
 * (`orca60` is "Medical Portal" there). Until 2026-08-29 this column was
 * `qms_ai`, DERIVED from master `is_active` — so the Modules pill and the
 * Status pill were one value rendered twice, and the same PATCH behind both.
 * That conflated two different acts: deactivating an account and unlicensing
 * one product.
 *
 * ## Ask Paul is TWO columns, ANDed — and there is no Status column
 *
 * `accounts.is_active` was shown as a separate "Status" pill until 2026-08-29.
 * It looked like an account-level gate and is not one: it is read in exactly two
 * places, both in the QMS AI backend — the per-request account resolver (403
 * "Account is inactive") and the pre-login `validate_account`.
 * **traceability-matrix never reads it**; the string does not occur in its
 * backend at all. So an account set Inactive could still sign in to
 * traceability, which is what an operator found by doing it.
 *
 * `is_active` is therefore not a gate over the platform — it is one half of Ask
 * Paul's switch, and the halves do different things:
 *
 *   is_active = 0        the app 403s every request — Ask Paul is dead
 *   allow_ask_paul = 0   only hides the hand-off button inside traceability
 *
 * So the pill ANDs them, and its toggle writes both. One control per module, and
 * off means off. Full record in INTERNAL_TRACE_MERGE.md §4.4.
 */

import { orcanosVirtualDirFromUrl } from './orcanos-url';
import { pgGet } from './supabase';
import { moduleFlag, type TraceAccountRow } from './trace';
import type { AccountListRow, MergedAccountRow } from './types';

/**
 * ## Ask Paul cannot be licensed without a database
 *
 * Ask Paul is the only module with a per-tenant vector store — Traceability and
 * Training read from the traceability instance's own SQLite. Licensing it for an
 * account that has no Supabase project behind it produces a button that leads to
 * an app with nowhere to read from, and neither half of the licence
 * (`accounts.is_active`, trace `allow_ask_paul`) can tell you that: both look
 * perfectly set. So the database is checked wherever the licence can be turned
 * ON — the create form, the list pill, and the traceability dialog — and on
 * every route behind them.
 *
 * Turning it OFF is never blocked. An account whose database was removed must
 * still be unlicensable.
 */
export const ASK_PAUL_NEEDS_DB =
  'Ask Paul needs a Supabase database for this account and none is configured. ' +
  'Provision or enter one under Edit → Vector DB first.';

/** Does this master row point at a database Ask Paul could actually use? */
export function hasAskPaulDatabase(a: {
  vector_db_host?: string | null;
  db_host?: string | null;
}): boolean {
  return Boolean((a.vector_db_host ?? '').trim() || (a.db_host ?? '').trim());
}

/**
 * The same question for an account identified by master id or Orcanos tenant.
 * A tenant with no master row has no database by definition — that is the
 * 12-of-15 trace-only case, not an error.
 */
export async function askPaulDatabaseExists(opts: {
  accountId?: string | null;
  tenant?: string | null;
}): Promise<boolean> {
  if (opts.accountId) {
    const rows = await pgGet<Array<{ db_host: string | null; vector_db_host: string | null }>>(
      `accounts?id=eq.${encodeURIComponent(opts.accountId)}&select=db_host,vector_db_host`,
    );
    return rows.length ? hasAskPaulDatabase(rows[0]) : false;
  }
  if (opts.tenant) {
    const tenant = opts.tenant.toLowerCase();
    const rows = await pgGet<
      Array<{ orcanos_api_url: string | null; db_host: string | null; vector_db_host: string | null }>
    >('accounts?select=orcanos_api_url,db_host,vector_db_host');
    const row = rows.find((r) => tenantOf(r) === tenant);
    return row ? hasAskPaulDatabase(row) : false;
  }
  return false;
}

// The catalog itself lives in `module-catalog.ts` because the accounts table
// renders it from a client component and this file reaches the admin password.

/** The master-side tenant, or null when the account has no Orcanos REST URL configured. */
export function tenantOf(account: Pick<AccountListRow, 'orcanos_api_url'>): string | null {
  const url = account.orcanos_api_url;
  if (!url) return null;
  return orcanosVirtualDirFromUrl(url)?.toLowerCase() ?? null;
}

/**
 * Union the two sources into one list, ordered by display name.
 *
 * `traceRows` empty is a legitimate state (the trace side is unreachable or not
 * configured): every account then shows its QMS AI half and a blank
 * traceability half, rather than the whole page failing.
 */
export function mergeAccounts(
  masterRows: AccountListRow[],
  traceRows: TraceAccountRow[],
  opts: { traceAvailable: boolean },
): MergedAccountRow[] {
  const traceByTenant = new Map(traceRows.map((r) => [r.account.toLowerCase(), r]));
  const claimed = new Set<string>();
  const merged: MergedAccountRow[] = [];

  for (const master of masterRows) {
    const tenant = tenantOf(master);
    const trace = tenant ? traceByTenant.get(tenant) : undefined;
    if (tenant && trace) claimed.add(tenant);
    merged.push(buildRow({ master, tenant, trace, traceAvailable: opts.traceAvailable }));
  }

  // Whatever the trace app knows about and master has never heard of. These are
  // the accounts the union is really for.
  for (const trace of traceRows) {
    const tenant = trace.account.toLowerCase();
    if (claimed.has(tenant)) continue;
    merged.push(buildRow({ master: null, tenant, trace, traceAvailable: opts.traceAvailable }));
  }

  return merged.sort((a, b) =>
    a.account_name.localeCompare(b.account_name, undefined, { sensitivity: 'base' }),
  );
}

function buildRow(args: {
  master: AccountListRow | null;
  tenant: string | null;
  trace: TraceAccountRow | undefined;
  traceAvailable: boolean;
}): MergedAccountRow {
  const { master, tenant, trace, traceAvailable } = args;

  // A tenant the trace app has denied sign-in to holds no module licence at all —
  // `check_account` returns before it ever looks at the per-module columns, so
  // reporting the columns' values would overstate what that account can reach.
  const signedIn = trace ? Boolean(trace.allow_access) : false;

  // null means "no answer from this source", which the UI renders as a dash
  // rather than as an unticked box. Unknown is not the same as off.
  const unknown = !traceAvailable || !trace;
  const traceModule = unknown ? null : signedIn && moduleFlag(trace, 'trace');
  const trainingModule = unknown ? null : signedIn && moduleFlag(trace, 'training');

  // Ask Paul has two halves and is licensed only when BOTH say yes — `is_active`
  // (the app itself) and `allow_ask_paul` (the door in from traceability). Off in
  // either place means a user does not get it, so anything else would over-report.
  // Whichever half has no row is simply not part of the AND; both missing is null.
  const askPaulHandoff = unknown ? null : signedIn && moduleFlag(trace, 'ask_paul');
  const askPaulApp = master ? Boolean(master.is_active) : null;
  const askPaulModule =
    askPaulApp === null ? askPaulHandoff : askPaulHandoff === null ? askPaulApp : askPaulApp && askPaulHandoff;

  return {
    key: master ? master.id : `trace:${tenant}`,
    // A traceability-only tenant has no display name anywhere — the tenant IS
    // the name until someone creates its master row.
    account_name: master ? master.account_name : (tenant ?? ''),
    tenant,

    id: master?.id ?? null,
    db_type: master?.db_type ?? null,
    // Only the boolean crosses to the browser — the hosts stay server-side.
    has_database: master ? hasAskPaulDatabase(master) : false,
    is_active: master ? Boolean(master.is_active) : null,
    created_at: master?.created_at ?? null,
    orcanos_api_url: master?.orcanos_api_url ?? null,

    total_cost_usd: Number(master?.total_cost_usd ?? 0),
    total_tokens: Number(master?.total_tokens ?? 0),

    trace_present: Boolean(trace),
    trace_allow_access: trace ? Boolean(trace.allow_access) : null,
    trace_allow_ai: trace ? Boolean(trace.allow_ai) : null,
    trace_allow_add: trace ? (trace.allow_add === undefined ? true : Boolean(trace.allow_add)) : null,
    trace_allow_ask_paul: trace ? moduleFlag(trace, 'ask_paul') : null,
    trace_ask_paul_account: trace?.ask_paul_account ?? '',
    trace_note: trace?.note ?? '',
    trace_cost_usd: Number(trace?.ai_cost_usd ?? 0),
    trace_tokens: Number(trace?.ai_tokens ?? 0),
    trace_ai_provider: trace?.ai_provider ?? '',

    modules: {
      ask_paul: askPaulModule,
      trace: traceModule,
      training: trainingModule,
    },
  };
}
