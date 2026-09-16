/**
 * Client for the traceability-matrix admin API — the second half of the merged
 * account list.
 *
 * SERVER ONLY. It holds the shared admin password; never import it from a
 * `'use client'` component.
 *
 * Why HTTP and not the database: traceability-matrix owns a SQLite file that
 * lives on a Fly volume (`/data/traceability.db`) or on a developer's laptop
 * (`src/backend/traceability.db`). Neither is reachable from a Vercel function,
 * and a SQLite file has exactly one writer by design (see that repo's Critical
 * Note #17 and its fly.toml warning about `fly scale count 2`). So the trace
 * process stays the only writer and we go through its API.
 *
 * ## There is one instance PER DATA REGION
 *
 * GDPR residency means an EU tenant's SQLite row must never be written into the
 * US database, so there are two independent Fly apps with two independent
 * volumes and nothing syncing them:
 *
 *   `TRACE_API_URL`     + `TRACE_ADMIN_PASSWORD`     → us  (Fly `iad`, :8010 in dev)
 *   `TRACE_API_URL_EU`  + `TRACE_ADMIN_PASSWORD_EU`  → eu  (Fly `fra`)
 *
 * Each deployment has its OWN admin password. The two databases never travel
 * together, so one password covering both would mean a single leak opens both
 * regions' admin APIs.
 *
 * Every function here therefore names the region it acts on. **There is no
 * default and no fallback** — see `traceApiUrlFor()` in `lib/regions.ts` for
 * why a fallback would be the bug rather than the safety net.
 *
 * `listTraceAccounts()` is the one that fans OUT: the console is global, so it
 * reads every configured region and tags each row with the region it came from.
 * That tag is what every subsequent write routes on, which means a write follows
 * the row it was read from and cannot be sent to the wrong instance by a caller
 * that forgot.
 *
 * Auth model (theirs, not ours): POST the password to /login and get back a
 * stateless HMAC token to send as `X-Admin-Token`. The token is derived from
 * the password, so it survives restarts — which is why caching it is safe and
 * why a password change invalidates every issued token at once. The cache is
 * keyed by region: the two apps may hold different admin passwords, and a token
 * minted by one is meaningless to the other.
 */

import { traceAdminPasswordFor } from './env';
import { DATA_REGIONS, traceApiUrlFor } from './regions';
import type { DataRegion, ModuleKey } from './types';

/** One row of the trace app's `account_access` table, as its admin API returns it. */
export interface TraceAccountRow {
  account: string;
  /**
   * Which regional instance this row was read from. **Not a column** — it is
   * stamped by `listTraceAccounts()` and stripped again by `saveTraceAccount()`,
   * so a write goes back to the instance the row came from. Absent only on a row
   * this app constructed itself (`newTraceAccountRow`).
   */
  region?: DataRegion;
  allow_access: number;
  allow_ai: number;
  allow_add?: number;
  /**
   * Per-module licence columns, added in traceability-matrix 3.23.0.
   * `undefined` means the instance predates them — see `moduleFlag()`.
   */
  allow_trace?: number;
  allow_training?: number;
  /**
   * BOM viewer licence, added in 3.46.0. OPT-IN: the column defaults to 0, and
   * `undefined` (an instance that predates it) reads as NOT licensed.
   */
  allow_bom?: number;
  /** Ask Paul (QMS AI) licence and name override, added in 3.27.0. */
  allow_ask_paul?: number;
  /**
   * What this tenant is called INSIDE Ask Paul — i.e. its master
   * `accounts.account_name`, which is usually NOT the Orcanos tenant
   * (`orca60` is "Medical Portal" there). '' means "send the tenant name".
   */
  ask_paul_account?: string;
  note?: string;
  updated_at?: string;
  ai_cost_usd?: number;
  ai_calls?: number;
  ai_tokens?: number;
  ai_provider?: string;
  ai_model?: string;
  ai_has_key?: boolean;
}

/**
 * Read a module licence flag the way `access_control._modules_of()` does:
 * an ABSENT column means "not configured", which is allowed. A row that
 * predates the column must never silently lose a module it already had.
 *
 * The distinction matters right now: production Fly is 3.21.0 and returns
 * neither `allow_trace` nor `allow_training`, so both read as licensed until
 * that deploy lands.
 */
export function moduleFlag(row: TraceAccountRow | undefined, key: ModuleKey): boolean {
  if (!row) return false;
  // ⚠️ BOM inverts the rule. Fail-open exists so a column added around a feature
  // every tenant already had does not take it away; nobody had BOM, so absent
  // means "never granted". Reading it as ON would show — and, on the next save
  // of a pre-3.46.0 row, write — a licence nobody gave. Mirrors
  // `MODULE_DEFAULTS` in the trace app's access_control.py.
  if (key === 'bom') return Boolean(row.allow_bom);
  const value =
    key === 'trace' ? row.allow_trace : key === 'training' ? row.allow_training : row.allow_ask_paul;
  return value === undefined || value === null ? true : Boolean(value);
}

/** Does this instance actually carry the per-module columns? (3.23.0) */
export function supportsModules(rows: TraceAccountRow[]): boolean {
  return rows.some((r) => r.allow_trace !== undefined || r.allow_training !== undefined);
}

/**
 * Does it carry `allow_ask_paul`? Checked SEPARATELY from `supportsModules`
 * because it landed four releases later (3.27.0): an instance on 3.23–3.26
 * writes trace/training correctly and would silently discard an Ask Paul flag.
 */
export function supportsAskPaul(rows: TraceAccountRow[]): boolean {
  return rows.some((r) => r.allow_ask_paul !== undefined);
}

/**
 * Does it carry `allow_bom`? (3.46.0) Checked separately again: an older instance
 * rewrites the row from a model with no such field, so a BOM tick would be
 * dropped and reported as saved.
 */
export function supportsBom(rows: TraceAccountRow[]): boolean {
  return rows.some((r) => r.allow_bom !== undefined);
}

/**
 * Does this row hold at least one module a user can actually sign in to?
 * Ask Paul does not count (separate app). Trace/training absent = ON, BOM absent
 * = OFF — the same reading as `moduleFlag()`.
 */
export function hasReachableModule(row: Partial<TraceAccountRow>): boolean {
  return Boolean(row.allow_trace ?? 1) || Boolean(row.allow_training ?? 1) || Boolean(row.allow_bom ?? 0);
}

export class TraceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'TraceApiError';
  }
}

/**
 * The base URL of one region's instance, or a thrown error naming the missing
 * variable. Never falls back to the other region — a write that lands in the
 * wrong region is invisible, and a thrown error is not.
 */
function baseUrl(region: DataRegion): string {
  const url = traceApiUrlFor(region);
  if (!url) {
    throw new TraceApiError(
      `No traceability instance is configured for the ${region.toUpperCase()} region ` +
        `(set ${region === 'eu' ? 'TRACE_API_URL_EU' : 'TRACE_API_URL'}).`,
      0,
    );
  }
  return url;
}

/**
 * The token is a pure function of the password, so one login per warm function
 * instance is enough. Cleared on a 401 so a rotated password self-heals on the
 * next call instead of needing a redeploy.
 *
 * Keyed by region — the two instances are separate deployments and a token
 * minted against one proves nothing to the other.
 */
const cachedTokens = new Map<DataRegion, string>();

async function login(region: DataRegion): Promise<string> {
  const res = await fetch(`${baseUrl(region)}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: traceAdminPasswordFor(region) }),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new TraceApiError(
      res.status === 401
        ? `${region === 'eu' ? 'TRACE_ADMIN_PASSWORD_EU' : 'TRACE_ADMIN_PASSWORD'} was rejected `+
          `by the ${region.toUpperCase()} traceability API.`
        : `Traceability admin login failed for ${region.toUpperCase()} (HTTP ${res.status}).`,
      res.status,
    );
  }
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new TraceApiError('Traceability admin login returned no token.', 502);
  return data.token;
}

async function call<T>(
  region: DataRegion,
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  let token = cachedTokens.get(region);
  if (!token) {
    token = await login(region);
    cachedTokens.set(region, token);
  }

  const res = await fetch(`${baseUrl(region)}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Token': token,
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });

  // A 401 here means the password changed under us. Drop the token and try once.
  if (res.status === 401 && retry) {
    cachedTokens.delete(region);
    return call<T>(region, path, init, false);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new TraceApiError(
      `Traceability API ${init.method ?? 'GET'} ${path} failed on ${region.toUpperCase()} ` +
        `(HTTP ${res.status})${body ? `: ${body.slice(0, 200)}` : ''}`,
      res.status,
    );
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/**
 * The regions that actually have an instance behind them right now.
 *
 * A region counts only when BOTH its URL and its OWN password are set. Each
 * deployment has its own `ADMIN_PASSWORD` — one password covering both regions
 * would mean a single leak opens both admin APIs — so a half-configured region
 * is treated as absent rather than being called with the other's credentials.
 */
export function traceRegions(): DataRegion[] {
  return DATA_REGIONS.filter(
    (r) =>
      traceApiUrlFor(r) &&
      (r === 'eu' ? process.env.TRACE_ADMIN_PASSWORD_EU : process.env.TRACE_ADMIN_PASSWORD),
  );
}

/**
 * Every tenant from every configured region, each row tagged with the region it
 * came from.
 *
 * **A region that fails throws.** It would be easy to return the regions that
 * answered, but that turns "the EU instance is unreachable" into "these EU
 * tenants do not exist" — and the callers render that as a fact, with unticked
 * module boxes and an offer to create a row that already exists elsewhere. The
 * existing callers all catch this and degrade the list with the message, which
 * is the honest outcome. Same reasoning as `moduleFlag()`: unknown is not off.
 */
export async function listTraceAccounts(): Promise<TraceAccountRow[]> {
  const regions = traceRegions();
  const perRegion = await Promise.all(
    regions.map(async (region) => {
      const data = await call<{ accounts?: TraceAccountRow[] }>(region, '/api/admin/accounts');
      return (data.accounts ?? []).map((row) => ({ ...row, region }));
    }),
  );
  return perRegion.flat();
}

/**
 * Find one tenant across every region, with the region it lives in.
 *
 * The tenant-scoped routes are addressed by name only (`/api/accounts/trace/
 * [tenant]/…`), so this is how they learn which instance to talk to. It costs a
 * list call, which is the same call those routes already made to find the row.
 *
 * `null` means no region has this tenant — genuinely absent, as distinct from a
 * region being unreachable, which throws out of `listTraceAccounts()`.
 */
export async function findTraceAccount(tenant: string): Promise<TraceAccountRow | null> {
  const wanted = tenant.trim().toLowerCase();
  if (!wanted) return null;
  const rows = await listTraceAccounts();
  return rows.find((r) => (r.account ?? '').trim().toLowerCase() === wanted) ?? null;
}

/**
 * The region that holds this tenant, for the routes that only need to know
 * where to send a call. Throws rather than guessing when nothing holds it — a
 * default here would send an EU tenant's AI key to the US instance.
 */
export async function traceRegionOf(tenant: string): Promise<DataRegion> {
  const row = await findTraceAccount(tenant);
  if (!row?.region) {
    throw new TraceApiError(
      `Tenant '${tenant}' was not found in any configured traceability instance, so there is ` +
        `no way to know which region owns it.`,
      404,
    );
  }
  return row.region;
}

/**
 * Columns the list endpoint derives for display. They are not part of the
 * write model, so they are dropped before an upsert rather than echoed back.
 */
const DERIVED_FIELDS = [
  // Not a column — this app's own tag for which instance the row came from. The
  // trace API's pydantic model would reject it, and it is the routing key, not
  // data to be stored.
  'region',
  'updated_at',
  'ai_cost_usd',
  'ai_calls',
  'ai_tokens',
  'ai_provider',
  'ai_model',
  'ai_has_key',
] as const;

/**
 * Upsert one row as CURRENT + CHANGES.
 *
 * The trace API has no PATCH: `POST /api/admin/accounts` rewrites the whole row
 * from a pydantic model, so any field the caller omits silently reverts to that
 * model's default. Sending only the fields we know about is therefore unsafe in
 * a way that gets worse over time — traceability-matrix 3.27.0 added
 * `allow_ask_paul` (default 1) and `ask_paul_account` (default ''), and a
 * console that predated them would have re-licensed Ask Paul and wiped the name
 * override on every unrelated save.
 *
 * So the merge is over the row as it came back, not over a field list this file
 * maintains. A column added on the trace side survives a save here without any
 * change to this code — which is the only version of this that stays correct.
 *
 * The write goes back to the instance `current` was READ from (`current.region`),
 * which is why that tag exists. A caller cannot pass the wrong region because it
 * does not pass one at all — and a row with no tag is refused rather than being
 * sent to a default, because the default would be the US instance and an EU
 * tenant's row landing there is exactly the violation this design prevents.
 */
export async function saveTraceAccount(
  current: TraceAccountRow,
  changes: Partial<TraceAccountRow> = {},
): Promise<void> {
  const region = current.region;
  if (!region) {
    throw new TraceApiError(
      `Cannot save '${current.account}': the row carries no region, so there is no way to ` +
        `know which traceability instance owns it. Read it with listTraceAccounts(), or build ` +
        `it with newTraceAccountRow(tenant, region).`,
      0,
    );
  }
  const row: Record<string, unknown> = { ...current, ...changes };
  for (const f of DERIVED_FIELDS) delete row[f];
  await call(region, '/api/admin/accounts', { method: 'POST', body: JSON.stringify(row) });
}

/**
 * The `account_access` row a tenant this console has never seen starts life as.
 *
 * Access, AI and add-items are the same defaults the trace `/admin` page
 * applies. **The three module columns are written as an explicit 0**, which is
 * the one non-obvious part: an ABSENT column reads as licensed (`moduleFlag()`,
 * matching `_modules_of`), so a sparse new row would silently license every
 * module — the opposite of what "the operator said nothing about it" means when
 * the row is being created rather than edited. Absence is a fail-open for rows
 * written before the columns existed; it is not a default for new ones.
 *
 * Exported because two callers create rows — account creation and the module
 * pill — and they must agree on what a new tenant starts as.
 */
export function newTraceAccountRow(tenant: string, region: DataRegion): TraceAccountRow {
  return {
    account: tenant.trim(),
    region,
    allow_access: 1,
    allow_ai: 1,
    allow_add: 1,
    allow_trace: 0,
    allow_training: 0,
    allow_bom: 0,
    allow_ask_paul: 0,
  };
}

/**
 * Give a tenant exactly these module licences, creating its `account_access`
 * row if it has none.
 *
 * Account creation is the one place the row may legitimately not exist yet:
 * every other caller is editing a tenant the trace instance already knows
 * about. A brand-new tenant gets `newTraceAccountRow()` and then whatever the
 * operator actually ticked.
 *
 * Only keys present in `modules` are written **to an existing row**. Leaving one
 * out means "don't express an opinion", which is not the same as `false`: an
 * absent column reads as licensed (`moduleFlag()`), so writing 0 where the
 * operator said nothing would silently revoke a module. On a new row the
 * unstated columns are 0 — see `newTraceAccountRow()` for why the two differ.
 *
 * `region` is where the row belongs when it has to be CREATED — the account's
 * `accounts.region`. When the row already exists its own region wins, and a
 * mismatch between the two is refused: it means master and the instances
 * disagree about where this tenant's data is, and licensing a module is not the
 * moment to pick a winner silently.
 */
export async function upsertTraceModules(
  tenant: string,
  modules: Partial<Record<ModuleKey, boolean>>,
  region: DataRegion,
): Promise<{ created: boolean }> {
  const wanted = tenant.trim().toLowerCase();
  if (!wanted) throw new TraceApiError('No Orcanos tenant to key the licences on', 0);

  const rows = await listTraceAccounts();
  const current = rows.find((r) => (r.account ?? '').trim().toLowerCase() === wanted);

  if (current && current.region && current.region !== region) {
    throw new TraceApiError(
      `Tenant '${tenant}' already exists in the ${current.region.toUpperCase()} traceability ` +
        `instance, but master records this account's region as ${region.toUpperCase()}. Its data ` +
        `is not where master says it is — resolve that before changing its licences.`,
      409,
    );
  }

  const base: TraceAccountRow = current ?? newTraceAccountRow(tenant, region);

  const changes: Partial<TraceAccountRow> = {};
  if (modules.ask_paul !== undefined) changes.allow_ask_paul = modules.ask_paul ? 1 : 0;
  if (modules.trace !== undefined) changes.allow_trace = modules.trace ? 1 : 0;
  if (modules.training !== undefined) changes.allow_training = modules.training ? 1 : 0;
  if (modules.bom !== undefined) {
    // Refuse rather than let an older instance drop the flag and report success.
    if (modules.bom && !supportsBom(rows)) {
      throw new TraceApiError(
        'this traceability instance predates the BOM licence (needs 3.46.0) and would have ' +
          'silently discarded it',
        409,
      );
    }
    changes.allow_bom = modules.bom ? 1 : 0;
  }

  await saveTraceAccount(base, changes);
  return { created: !current };
}

/**
 * Point EVERY configured region's directory at the region that owns this tenant.
 *
 * This is the one write that deliberately crosses regions, and it is safe to
 * because of what it contains: a tenant name and a region string. No personal
 * data, nothing an EU customer's DPA covers. Sessions, panels, snapshots and
 * quizzes never cross.
 *
 * WHY EVERY REGION NEEDS IT. Each instance holds only its own region's tenants,
 * so an EU tenant has no row at all in the US database. Without a directory
 * entry, an EU user who opens the US address is told "contact us to open an
 * account" — false, and a dead end. With one, that instance can send them to the
 * right address *before* they type a password, which matters: credentials POSTed
 * to the wrong region are a cross-border transfer in themselves.
 *
 * ⚠️ BEST EFFORT ON PURPOSE, and this is only sound because the directory
 * **grants nothing** — the trace side never consults it in a gate, and treats a
 * missing entry as "no idea", not as "here". So a region that fails to record the
 * signpost produces a worse error message for that tenant, never access to the
 * wrong region's data. Returns the regions that failed so the caller can say so;
 * it does not throw, because a directory hint must never be the thing that fails
 * an account creation.
 */
export async function upsertRegionDirectory(
  tenant: string,
  region: DataRegion,
): Promise<{ failed: DataRegion[] }> {
  const name = tenant.trim().toLowerCase();
  if (!name) return { failed: [] };

  const failed: DataRegion[] = [];
  await Promise.all(
    traceRegions().map(async (target) => {
      try {
        await call(target, '/api/admin/regions', {
          method: 'POST',
          body: JSON.stringify({ account: name, region }),
        });
      } catch (e) {
        // An instance older than the directory endpoint answers 404. That is not
        // a failure worth reporting to an operator — it is a version skew that
        // resolves itself on the next deploy, and the old behaviour (an unhelpful
        // unknown-account message) is exactly what it had before.
        const status = e instanceof TraceApiError ? e.status : 0;
        if (status === 404) {
          console.warn(`[regions] ${target} predates the directory endpoint — skipped`);
          return;
        }
        console.error(`[regions] could not write directory on ${target}:`, e);
        failed.push(target);
      }
    }),
  );
  return { failed };
}

/* ── Moving a tenant between regions (0.5.0) ────────────────────────────────
 * Three calls against ONE instance each; the sequencing lives in
 * `api/accounts/move`. Nothing here decides anything — deciding when it is safe
 * to purge is the orchestrator's job, and it is the only place that has seen
 * both halves.
 */

export interface TenantExport {
  tenant: string;
  account_ids: string[];
  tables: Record<string, Array<Record<string, unknown>>>;
  counts: Record<string, number>;
  total_rows: number;
}

export interface TenantImportResult {
  tenant: string;
  counts: Record<string, number>;
  total_rows: number;
  skipped_tables: Record<string, string>;
}

/** Everything one region holds for this tenant. Excludes sessions by design. */
export async function exportTenant(tenant: string, region: DataRegion): Promise<TenantExport> {
  return call<TenantExport>(region, `/api/admin/tenants/${encodeURIComponent(tenant)}/export`);
}

/** Insert an export into another region. One transaction, idempotent by key. */
export async function importTenant(
  payload: TenantExport,
  region: DataRegion,
): Promise<TenantImportResult> {
  return call<TenantImportResult>(region, '/api/admin/tenants/import', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Delete every row a region holds for this tenant.
 *
 * ⚠️ Irreversible, and it takes quiz attempts with it — the one thing Orcanos
 * cannot rebuild. The tenant name is sent again in the body because the instance
 * refuses a mismatch: this is called from an orchestrator that has just been
 * talking to two instances about two tenants.
 */
export async function purgeTenant(
  tenant: string,
  region: DataRegion,
): Promise<{ total_rows: number; counts: Record<string, number> }> {
  return call(region, `/api/admin/tenants/${encodeURIComponent(tenant)}/purge`, {
    method: 'POST',
    body: JSON.stringify({ confirm_account: tenant }),
  });
}

export async function deleteTraceAccount(account: string, region: DataRegion): Promise<void> {
  await call(region, `/api/admin/accounts/${encodeURIComponent(account)}`, { method: 'DELETE' });
}

/* ── AI engine ──────────────────────────────────────────────────────────────
 * Per-tenant provider routing. Distinct from the master DB's
 * `account_llm_keys`: that key drives QMS AI's RAG and chat, this one drives
 * panel-describe, trace-build and duplicate scoring, and can route to the
 * Orcanos Bedrock gateway. Different providers, different models — they are
 * two settings that happen to share a word, not one setting in two places.
 */

export interface TraceEngineCatalog {
  providers: Array<{ key: string; label: string }>;
  models: Record<string, string[]>;
  default_model: Record<string, string>;
  bedrock_env_key_present: boolean;
}

export interface TraceEngineInfo {
  catalog: TraceEngineCatalog;
  /** The reserved `*` row every unconfigured tenant inherits. */
  global_default: { provider: string; model: string; has_key: boolean };
}

/**
 * The provider catalog of ONE region's instance. The two are separate
 * deployments that can be on different versions and hold different global
 * defaults, so this is deliberately not merged — the editor for a tenant asks
 * the instance that actually runs that tenant's AI.
 */
export async function getTraceEngine(region: DataRegion): Promise<TraceEngineInfo> {
  return call<TraceEngineInfo>(region, '/api/admin/engine');
}

/**
 * `api_key` semantics are the trace API's, and they are the same three-state
 * contract this app already uses for account secrets:
 *   null  → keep the stored key
 *   ''    → clear it (fall back to the server's env key)
 *   other → set it
 * Sending '' when the operator meant "unchanged" silently downgrades a tenant
 * to the shared key, so the caller must be explicit.
 */
export async function saveTraceAiConfig(
  account: string,
  cfg: { provider: string; model: string; api_key: string | null },
  region: DataRegion,
): Promise<void> {
  await call(region, `/api/admin/accounts/${encodeURIComponent(account)}/ai-config`, {
    method: 'POST',
    body: JSON.stringify(cfg),
  });
}

/** Live-verify a provider/model/key against the real API before it is stored. */
export async function testTraceAiConfig(
  body: {
    provider: string;
    model: string;
    api_key: string | null;
    account: string;
  },
  region: DataRegion,
): Promise<{ ok: boolean; message?: string; model?: string }> {
  return call(region, '/api/admin/ai-config/test', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export interface TraceUsageRow {
  created_at: string;
  user_id: string;
  source: string;
  source_label?: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  setup_id: string;
  ok: number;
  note: string;
}

export async function listTraceUsage(
  account: string,
  region: DataRegion,
  limit = 200,
): Promise<{ total_cost_usd: number; total_calls: number; rows: TraceUsageRow[] }> {
  return call(
    region,
    `/api/admin/accounts/${encodeURIComponent(account)}/usage?limit=${encodeURIComponent(limit)}`,
  );
}

/**
 * Is the traceability side configured at all? Lets the list degrade instead of
 * erroring. True when AT LEAST ONE region is reachable — the US instance alone
 * is the normal state today, and the console must keep working while the EU one
 * does not exist yet.
 */
export function traceConfigured(): boolean {
  return traceRegions().length > 0;
}
