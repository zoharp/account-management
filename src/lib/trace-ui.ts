/**
 * The browser-side shapes of the traceability admin API.
 *
 * Client-safe by construction — types and one pure helper, nothing that reaches
 * `node:crypto`, a service key or `lib/trace.ts` (CLAUDE.md, "What NOT to do").
 * They live here rather than inside one component because the tenant's trace row
 * is now read by three different tabs — Traceability, Ask Paul and LLM — each
 * owning a different slice of the same row.
 *
 * Mirrored from that app rather than reinvented, so the two stay diffable while
 * both exist.
 */

export interface TraceRow {
  account: string;
  allow_access: number;
  allow_ai: number;
  allow_add?: number;
  allow_trace?: number;
  allow_training?: number;
  allow_ask_paul?: number;
  ask_paul_account?: string;
  note?: string;
  updated_at?: string;
  ai_cost_usd?: number;
  ai_calls?: number;
  ai_provider?: string;
  ai_model?: string;
  ai_has_key?: boolean;
}

export interface TraceEngine {
  catalog: {
    providers: Array<{ key: string; label: string }>;
    models: Record<string, string[]>;
    default_model: Record<string, string>;
    bedrock_env_key_present: boolean;
  };
  global_default: { provider: string; model: string; has_key: boolean };
}

export interface TraceUsageRow {
  created_at: string;
  user_id: string;
  source_label?: string;
  source: string;
  model: string;
  total_tokens: number;
  cost_usd: number;
  ok: number;
}

/** What `GET /api/accounts/trace/:tenant` answers with. */
export interface TraceSettingsResponse {
  row: TraceRow | null;
  engine: TraceEngine | null;
  supports_modules: boolean;
  master_account_name: string | null;
  master_has_database: boolean;
  detail?: string;
}

/**
 * An absent flag is ON.
 *
 * A row written before a column existed reads as `undefined`, which the trace
 * app's `access_control._modules_of` treats as licensed. An account must never
 * lose a capability because a column was added around it — so `undefined` is
 * *licensed*, never *off*.
 */
export const on = (v: number | undefined, fallback = true) =>
  v === undefined ? fallback : Boolean(v);

/**
 * Copy of `ASK_PAUL_NEEDS_DB` in `lib/modules.ts`. **Not imported** — that module
 * reaches the Supabase service key and must never be pulled into a client
 * component. The server returns the real one on a refused save.
 */
export const ASK_PAUL_NEEDS_DB_HINT =
  'Ask Paul needs a Supabase database for this account and none is configured. ' +
  'Fill in the Vector DB section on this tab first.';
