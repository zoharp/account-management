/**
 * Shapes of the master-DB rows this app touches.
 * Column names track `MD files/SCHEMA.md` §10, §18, §19 in the QMS repo.
 */

export interface PlatformUser {
  id: number;
  email: string;
  display_name: string | null;
  role: 'admin' | 'user' | string;
  auth_method?: string | null;
  last_login_at?: string | null;
  /** The Orcanos identity join key — see `sql/002_orcanos_identity.sql`. */
  orcanos_user_name?: string | null;
  orcanos_account?: string | null;
}

/** The non-secret columns of `accounts` — no `*_encrypted` column ever leaves the server. */
export interface AccountRow {
  id: string;
  account_name: string;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;

  // Legacy pair, kept in sync with vector_db_* by the QMS backend
  db_type?: string | null;
  db_host?: string | null;
  db_name?: string | null;
  db_user?: string | null;
  connection_string?: string | null;

  // Orcanos SQL Server (customer's own, read-only)
  orcanos_db_type?: string | null;
  orcanos_db_host?: string | null;
  orcanos_db_name?: string | null;
  orcanos_db_user?: string | null;
  orcanos_connection_string?: string | null;

  // Orcanos REST API
  orcanos_api_url?: string | null;
  orcanos_username?: string | null;

  // Vector DB (the provisioned Supabase project)
  vector_db_type?: string | null;
  vector_db_host?: string | null;
  vector_db_name?: string | null;
  vector_db_user?: string | null;
  vector_connection_string?: string | null;
}

export interface AccountListRow extends AccountRow {
  total_cost_usd: number;
  total_tokens: number;
}

/** The modules an account can be licensed for. See `lib/modules.ts`. */
export type ModuleKey = 'ask_paul' | 'trace' | 'training';

/**
 * `null` means the source that owns this module has no row for this tenant —
 * rendered as a dash, never as an unticked box. Unknown is not the same as off.
 */
export type AccountModules = Record<ModuleKey, boolean | null>;

/** One row of the merged list: the master half, the traceability half, or both. */
export interface MergedAccountRow {
  /** Stable React key. The master uuid when there is one, else `trace:<tenant>`. */
  key: string;
  account_name: string;
  /** Orcanos `Virtual_dir`. The merge key — see `lib/modules.ts`. */
  tenant: string | null;

  // ── master `accounts` half — every field null for a traceability-only tenant
  id: string | null;
  db_type: string | null;
  /**
   * Whether a vector database is configured for this account. Ask Paul is the
   * only module that needs one, and it cannot be licensed without it — see
   * `ASK_PAUL_NEEDS_DB` in `lib/modules.ts`. False for a traceability-only
   * tenant, which has no master row at all.
   */
  has_database: boolean;
  is_active: boolean | null;
  created_at: string | null;
  orcanos_api_url: string | null;
  total_cost_usd: number;
  total_tokens: number;

  // ── traceability `account_access` half
  trace_present: boolean;
  trace_allow_access: boolean | null;
  trace_allow_ai: boolean | null;
  trace_allow_add: boolean | null;
  /** The Ask Paul (QMS AI) licence — absent column reads as licensed, per `moduleFlag`. */
  trace_allow_ask_paul: boolean | null;
  /** What this tenant is called inside Ask Paul; '' means "send the tenant name". */
  trace_ask_paul_account: string;
  trace_note: string;
  trace_cost_usd: number;
  trace_tokens: number;
  trace_ai_provider: string;

  modules: AccountModules;
}

/** Why the traceability half of the list is (or isn't) there. */
export interface TraceSourceStatus {
  available: boolean;
  /** False when the instance predates the per-module columns (< 3.23.0). */
  supports_modules: boolean;
  /** False when the instance predates `allow_ask_paul` (< 3.27.0) — a later column than the above. */
  supports_ask_paul: boolean;
  /** Which instance answered — shown in the UI so local-vs-Fly is never a guess. */
  url: string | null;
  message: string;
}

export interface LlmKeyStatus {
  id: string;
  engine: string;
  expires_at: string | null;
  last_test_status: string | null;
  last_test_error: string | null;
  updated_at: string | null;
}

export interface UsageLogRow {
  id: number;
  account_id: string;
  account_name: string;
  repository_id: number | null;
  repository_name: string | null;
  action: string;
  conversation_name: string | null;
  tokens: number | null;
  cost_usd: number | string | null;
  created_at: string;
}

export interface AuditLogRow {
  id: number;
  event_type: string;
  account_name: string | null;
  actor_user_id: number | null;
  actor_email: string | null;
  success: boolean;
  detail: Record<string, unknown>;
  created_at: string;
}

/** `{success: null}` means "nothing configured to test" — rendered as a neutral note. */
export interface ConnectionTestResult {
  success: boolean | null;
  message?: string;
  error?: string;
}

export interface AuthMethodOption {
  type: 'google' | 'office365' | 'local';
  client_id?: string;
  tenant?: string;
  password_policy?: Record<string, unknown>;
}

/** One step of a provisioning job, as stored in `account_provisioning.state`. */
export type ProvisionState =
  | 'creating_project'
  | 'waiting_healthy'
  | 'fetching_keys'
  | 'running_schema'
  | 'saving_account'
  | 'done'
  | 'error';

export interface ProvisionJob {
  id: string;
  account_name: string;
  project_ref: string | null;
  state: ProvisionState;
  project_status: string | null;
  message: string | null;
  account_id: string | null;
  created_at: string;
  updated_at: string;
}
