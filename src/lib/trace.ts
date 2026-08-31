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
 * Which instance we talk to is purely `TRACE_API_URL`:
 *   local dev  → http://127.0.0.1:8010        (run_dev.bat, its own SQLite)
 *   Vercel     → https://traceability-matrix.fly.dev
 * Same code either way — point local at Fly whenever you want real data, but
 * remember that every module toggle then writes to production.
 *
 * Auth model (theirs, not ours): POST the password to /login and get back a
 * stateless HMAC token to send as `X-Admin-Token`. The token is derived from
 * the password, so it survives restarts — which is why caching it is safe and
 * why a password change invalidates every issued token at once.
 */

import { traceAdminPassword, traceApiUrl } from './env';
import type { ModuleKey } from './types';

/** One row of the trace app's `account_access` table, as its admin API returns it. */
export interface TraceAccountRow {
  account: string;
  allow_access: number;
  allow_ai: number;
  allow_add?: number;
  /**
   * Per-module licence columns, added in traceability-matrix 3.23.0.
   * `undefined` means the instance predates them — see `moduleFlag()`.
   */
  allow_trace?: number;
  allow_training?: number;
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
 * The token is a pure function of the password, so one login per warm function
 * instance is enough. Cleared on a 401 so a rotated password self-heals on the
 * next call instead of needing a redeploy.
 */
let cachedToken: string | null = null;

async function login(): Promise<string> {
  const res = await fetch(`${traceApiUrl()}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: traceAdminPassword() }),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new TraceApiError(
      res.status === 401
        ? 'TRACE_ADMIN_PASSWORD was rejected by the traceability API.'
        : `Traceability admin login failed (HTTP ${res.status}).`,
      res.status,
    );
  }
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new TraceApiError('Traceability admin login returned no token.', 502);
  return data.token;
}

async function call<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  cachedToken ??= await login();

  const res = await fetch(`${traceApiUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Token': cachedToken,
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });

  // A 401 here means the password changed under us. Drop the token and try once.
  if (res.status === 401 && retry) {
    cachedToken = null;
    return call<T>(path, init, false);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new TraceApiError(
      `Traceability API ${init.method ?? 'GET'} ${path} failed (HTTP ${res.status})${
        body ? `: ${body.slice(0, 200)}` : ''
      }`,
      res.status,
    );
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export async function listTraceAccounts(): Promise<TraceAccountRow[]> {
  const data = await call<{ accounts?: TraceAccountRow[] }>('/api/admin/accounts');
  return data.accounts ?? [];
}

/**
 * Columns the list endpoint derives for display. They are not part of the
 * write model, so they are dropped before an upsert rather than echoed back.
 */
const DERIVED_FIELDS = [
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
 */
export async function saveTraceAccount(
  current: TraceAccountRow,
  changes: Partial<TraceAccountRow> = {},
): Promise<void> {
  const row: Record<string, unknown> = { ...current, ...changes };
  for (const f of DERIVED_FIELDS) delete row[f];
  await call('/api/admin/accounts', { method: 'POST', body: JSON.stringify(row) });
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
export function newTraceAccountRow(tenant: string): TraceAccountRow {
  return {
    account: tenant.trim(),
    allow_access: 1,
    allow_ai: 1,
    allow_add: 1,
    allow_trace: 0,
    allow_training: 0,
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
 */
export async function upsertTraceModules(
  tenant: string,
  modules: Partial<Record<ModuleKey, boolean>>,
): Promise<{ created: boolean }> {
  const wanted = tenant.trim().toLowerCase();
  if (!wanted) throw new TraceApiError('No Orcanos tenant to key the licences on', 0);

  const rows = await listTraceAccounts();
  const current = rows.find((r) => (r.account ?? '').trim().toLowerCase() === wanted);

  const base: TraceAccountRow = current ?? newTraceAccountRow(tenant);

  const changes: Partial<TraceAccountRow> = {};
  if (modules.ask_paul !== undefined) changes.allow_ask_paul = modules.ask_paul ? 1 : 0;
  if (modules.trace !== undefined) changes.allow_trace = modules.trace ? 1 : 0;
  if (modules.training !== undefined) changes.allow_training = modules.training ? 1 : 0;

  await saveTraceAccount(base, changes);
  return { created: !current };
}

export async function deleteTraceAccount(account: string): Promise<void> {
  await call(`/api/admin/accounts/${encodeURIComponent(account)}`, { method: 'DELETE' });
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

export async function getTraceEngine(): Promise<TraceEngineInfo> {
  return call<TraceEngineInfo>('/api/admin/engine');
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
): Promise<void> {
  await call(`/api/admin/accounts/${encodeURIComponent(account)}/ai-config`, {
    method: 'POST',
    body: JSON.stringify(cfg),
  });
}

/** Live-verify a provider/model/key against the real API before it is stored. */
export async function testTraceAiConfig(body: {
  provider: string;
  model: string;
  api_key: string | null;
  account: string;
}): Promise<{ ok: boolean; message?: string; model?: string }> {
  return call('/api/admin/ai-config/test', { method: 'POST', body: JSON.stringify(body) });
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
  limit = 200,
): Promise<{ total_cost_usd: number; total_calls: number; rows: TraceUsageRow[] }> {
  return call(
    `/api/admin/accounts/${encodeURIComponent(account)}/usage?limit=${encodeURIComponent(limit)}`,
  );
}

/** Is the traceability side configured at all? Lets the list degrade instead of erroring. */
export function traceConfigured(): boolean {
  return Boolean(process.env.TRACE_API_URL && process.env.TRACE_ADMIN_PASSWORD);
}
