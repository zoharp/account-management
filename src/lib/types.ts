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
