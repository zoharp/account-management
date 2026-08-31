/**
 * One-click per-account database provisioning via the Supabase Management API.
 *
 * Port of `backend/provisioning.py`, restructured for serverless.
 *
 * WHY THE SHAPE CHANGED. The Python version is a generator that streams NDJSON
 * from a single long-lived request: create project → sleep-poll for up to 300s →
 * fetch keys → run DDL → insert the account row. On Cloud Run that is fine. On
 * Vercel it is not: if the function hits its duration limit mid-poll, the
 * Supabase project exists and is being billed, but no account row was ever
 * written and nothing records that the project belongs to anyone. That is the
 * worst possible failure for a control plane.
 *
 * So provisioning here is a RESUMABLE JOB. `startProvisioning()` does only the
 * fast part and persists a row in `account_provisioning`; `tickProvisioning()`
 * advances the job by exactly one step and returns. The client polls. A closed
 * browser, a redeploy or a function timeout costs one tick, not the job — the
 * next tick picks up from the persisted state, and an abandoned job is visible
 * in the table instead of being an invisible orphan project.
 *
 * The event vocabulary the UI renders is unchanged from the Python
 * (`starting`/`created`/`provisioning`/`fetching_keys`/`running_schema`/`done`),
 * so the progress log reads exactly as it does in QMS today.
 *
 * NOTE carried over from the Python: the Management API field names below
 * follow Supabase's documented v1 API but had not been exercised against a live
 * org when the original was written. `readServiceKey()` is deliberately lenient
 * about response shape for that reason. Verify against a real response the
 * first time this runs end to end.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { decryptSecret, encryptSecret, generateDbPassword } from './crypto';
import { projectRegion, supabaseOrgAccessToken, supabaseOrgId } from './env';
import { orcanosVirtualDirFromUrl } from './orcanos-url';
import { pgGet, pgPatch, pgPost } from './supabase';
import { upsertTraceModules } from './trace';
import type { ModuleKey, ProvisionState } from './types';

const MANAGEMENT_API = 'https://api.supabase.com/v1';
const HEALTHY_STATUSES = new Set(['ACTIVE_HEALTHY']);
const FAILED_STATUSES = new Set(['INIT_FAILED', 'REMOVED', 'RESTORE_FAILED', 'PAUSE_FAILED']);

/** How long a job may sit in `waiting_healthy` before we call it failed. */
const HEALTHY_TIMEOUT_MS = 10 * 60 * 1000;

export class ProvisioningError extends Error {}

function mgmtHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${supabaseOrgAccessToken()}`,
    'Content-Type': 'application/json',
  };
}

/**
 * The Supabase project name for an account's own database.
 *
 * **Convention (2026-08-31): `askpaul-<account_name>`.** The prefix names the
 * product that actually owns the database — Ask Paul is the only module with a
 * per-tenant vector store — and the suffix is the account name verbatim, so a
 * project in the Supabase dashboard can be matched to an account by reading it.
 * The existing projects were renamed to match: `qms-orcanos` →
 * `askpaul-orcanos`, `qms-medical-portal` → `askpaul-orca60` (that account had
 * been renamed to its Orcanos tenant), and the master is `accounts-master`.
 *
 * Was `qms-<slug>`, which named a product this app is not and left names
 * stranded when an account was renamed.
 *
 * Lower-cased and non-alphanumerics collapsed to `-`, because a project name
 * ends up in hostnames and CLI arguments. So account `Orcanos` yields
 * `askpaul-orcanos` — the same string, normalised, not a different one.
 */
export function slugify(accountName: string): string {
  const slug = accountName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (`askpaul-${slug}`).slice(0, 63) || 'askpaul-account';
}

export interface JobRow {
  id: string;
  account_name: string;
  project_ref: string | null;
  db_password_encrypted: string | null;
  service_key_encrypted: string | null;
  payload: Record<string, unknown> | null;
  state: ProvisionState;
  project_status: string | null;
  message: string | null;
  account_id: string | null;
  created_at: string;
  updated_at: string;
}

/** What the client sees — never the secret columns. */
export interface JobView {
  id: string;
  account_name: string;
  project_ref: string | null;
  state: ProvisionState;
  project_status: string | null;
  message: string | null;
  account_id: string | null;
}

export function toJobView(job: JobRow): JobView {
  return {
    id: job.id,
    account_name: job.account_name,
    project_ref: job.project_ref,
    state: job.state,
    project_status: job.project_status,
    message: job.message,
    account_id: job.account_id,
  };
}

async function updateJob(id: string, patch: Partial<JobRow>): Promise<JobRow> {
  const rows = await pgPatch<JobRow[]>(`account_provisioning?id=eq.${encodeURIComponent(id)}`, {
    ...patch,
    updated_at: new Date().toISOString(),
  });
  return rows[0];
}

export async function getJob(id: string): Promise<JobRow | null> {
  const rows = await pgGet<JobRow[]>(
    `account_provisioning?id=eq.${encodeURIComponent(id)}&select=*`,
  );
  return rows[0] ?? null;
}

/**
 * Step 1 — the fast part: create the Supabase project and persist the job.
 * Returns as soon as the Management API has accepted the project, typically
 * a couple of seconds. Everything after this is driven by `tickProvisioning`.
 */
export async function startProvisioning(
  accountName: string,
  payload: Record<string, unknown>,
  requestedByEmail: string | null,
): Promise<JobRow> {
  const dbPassword = generateDbPassword();
  const projectName = slugify(accountName);

  const created = await pgPost<JobRow[]>('account_provisioning', {
    account_name: accountName,
    state: 'creating_project' satisfies ProvisionState,
    message: `Creating Supabase project for '${accountName}'`,
    db_password_encrypted: encryptSecret(dbPassword),
    payload,
    requested_by_email: requestedByEmail,
  });
  const job = created[0];

  let res: Response;
  try {
    res = await fetch(`${MANAGEMENT_API}/projects`, {
      method: 'POST',
      headers: mgmtHeaders(),
      body: JSON.stringify({
        name: projectName,
        organization_id: supabaseOrgId(),
        db_pass: dbPassword,
        region: projectRegion(),
      }),
      signal: AbortSignal.timeout(30000),
      cache: 'no-store',
    });
  } catch (e) {
    return updateJob(job.id, {
      state: 'error',
      message: `Project creation request failed: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  if (res.status !== 200 && res.status !== 201) {
    const body = (await res.text()).slice(0, 300);
    return updateJob(job.id, {
      state: 'error',
      message: `Project creation failed: ${res.status} ${body}`,
    });
  }

  const project = (await res.json()) as Record<string, unknown>;
  const projectRef = (project.id ?? project.ref) as string | undefined;
  if (!projectRef) {
    return updateJob(job.id, {
      state: 'error',
      message: `Unexpected response from Supabase, no project ref: ${JSON.stringify(project).slice(0, 200)}`,
    });
  }

  return updateJob(job.id, {
    project_ref: projectRef,
    state: 'waiting_healthy',
    message: 'Project created, waiting for it to come online (usually 1-2 min)',
  });
}

/**
 * Advance a job by exactly one step. Safe to call repeatedly; a job already in
 * `done` or `error` is returned unchanged.
 */
export async function tickProvisioning(jobId: string): Promise<JobRow> {
  const job = await getJob(jobId);
  if (!job) throw new ProvisioningError('Provisioning job not found');
  if (job.state === 'done' || job.state === 'error') return job;

  try {
    switch (job.state) {
      case 'creating_project':
        // startProvisioning always moves past this state; reaching it here means
        // the start request died between the insert and the Management API call.
        return updateJob(job.id, {
          state: 'error',
          message: 'Project creation never completed — start the account again.',
        });

      case 'waiting_healthy':
        return await tickWaitingHealthy(job);

      case 'fetching_keys':
        return await tickFetchingKeys(job);

      case 'running_schema':
        return await tickRunningSchema(job);

      case 'saving_account':
        return await tickSavingAccount(job);

      default:
        return job;
    }
  } catch (e) {
    return updateJob(job.id, {
      state: 'error',
      message: (e instanceof Error ? e.message : String(e)).slice(0, 500),
    });
  }
}

async function tickWaitingHealthy(job: JobRow): Promise<JobRow> {
  if (Date.now() - new Date(job.created_at).getTime() > HEALTHY_TIMEOUT_MS) {
    return updateJob(job.id, {
      state: 'error',
      message: `Timed out waiting for project ${job.project_ref} to become healthy.`,
    });
  }

  const res = await fetch(`${MANAGEMENT_API}/projects/${job.project_ref}`, {
    headers: mgmtHeaders(),
    signal: AbortSignal.timeout(15000),
    cache: 'no-store',
  });
  if (!res.ok) {
    // Transient — stay in this state and let the next poll retry.
    return updateJob(job.id, { project_status: `checking (HTTP ${res.status})` });
  }

  const status = String(((await res.json()) as Record<string, unknown>).status ?? '');

  if (HEALTHY_STATUSES.has(status)) {
    return updateJob(job.id, {
      state: 'fetching_keys',
      project_status: status,
      message: 'Project is healthy, fetching API keys',
    });
  }
  if (FAILED_STATUSES.has(status)) {
    return updateJob(job.id, {
      state: 'error',
      project_status: status,
      message: `Project provisioning failed with status ${status}`,
    });
  }
  return updateJob(job.id, { project_status: status });
}

/** Tolerant of the two documented key-list shapes; see the note at the top. */
function readServiceKey(body: unknown): string | null {
  const entries = Array.isArray(body)
    ? body
    : Array.isArray((body as Record<string, unknown>)?.keys)
      ? ((body as Record<string, unknown>).keys as unknown[])
      : [];
  for (const raw of entries) {
    const k = raw as Record<string, unknown>;
    if (k?.name === 'service_role') {
      const value = k.api_key ?? k.apiKey ?? k.key;
      if (typeof value === 'string' && value) return value;
    }
  }
  return null;
}

async function tickFetchingKeys(job: JobRow): Promise<JobRow> {
  const res = await fetch(`${MANAGEMENT_API}/projects/${job.project_ref}/api-keys`, {
    headers: mgmtHeaders(),
    signal: AbortSignal.timeout(15000),
    cache: 'no-store',
  });
  if (!res.ok) {
    return updateJob(job.id, {
      state: 'error',
      message: `Could not fetch API keys: ${res.status} ${(await res.text()).slice(0, 300)}`,
    });
  }

  const serviceKey = readServiceKey(await res.json());
  if (!serviceKey) {
    return updateJob(job.id, {
      state: 'error',
      message: 'No service_role key found in project API keys',
    });
  }

  return updateJob(job.id, {
    service_key_encrypted: encryptSecret(serviceKey),
    state: 'running_schema',
    message: 'Running bootstrap schema against the new database',
  });
}

/**
 * Run the whole bootstrap file in one statement, as the Python does.
 * PostgREST cannot execute DDL, so this is a direct Postgres connection using
 * the password generated at project-creation time.
 */
async function tickRunningSchema(job: JobRow): Promise<JobRow> {
  if (!job.project_ref || !job.db_password_encrypted) {
    return updateJob(job.id, { state: 'error', message: 'Job is missing its project credentials' });
  }

  const sqlPath = path.join(process.cwd(), 'sql', 'bootstrap_new_account.sql');
  const sql = await readFile(sqlPath, 'utf8');
  const password = decryptSecret(job.db_password_encrypted);

  const { Client } = await import('pg');
  const client = new Client({
    host: `db.${job.project_ref}.supabase.co`,
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password,
    connectionTimeoutMillis: 15000,
    statement_timeout: 120000,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end().catch(() => {});
  }

  return updateJob(job.id, { state: 'saving_account', message: 'Saving account' });
}

/**
 * Final step — write the `accounts` row.
 *
 * Field-for-field the same row the Python builds, including writing the SAME
 * provisioned service key into both the legacy `db_password_encrypted` and
 * `vector_db_password_encrypted` columns. The legacy pair is what the QMS
 * middleware still reads on some paths, so both must be populated.
 */
async function tickSavingAccount(job: JobRow): Promise<JobRow> {
  if (!job.service_key_encrypted || !job.project_ref) {
    return updateJob(job.id, { state: 'error', message: 'Job is missing its service key' });
  }

  const body = (job.payload ?? {}) as Record<string, string | undefined>;
  const vectorHost = `https://${job.project_ref}.supabase.co`;
  const serviceKeyEncrypted = job.service_key_encrypted;

  const row: Record<string, unknown> = {
    account_name: job.account_name,
    is_active: true,
    db_type: 'supabase',
    db_host: vectorHost,
    db_name: 'postgres',
    db_user: 'postgres',
    db_password_encrypted: serviceKeyEncrypted,
    vector_db_type: 'supabase',
    vector_db_host: vectorHost,
    vector_db_name: 'postgres',
    vector_db_user: 'postgres',
    vector_db_password_encrypted: serviceKeyEncrypted,
    orcanos_db_type: 'sqlserver',
    orcanos_db_host: body.orcanos_db_host ?? '',
    orcanos_db_name: body.orcanos_db_name ?? '',
    orcanos_db_user: body.orcanos_db_user ?? '',
    orcanos_api_url: body.orcanos_api_url || null,
    orcanos_username: body.orcanos_username || null,
  };

  // Passwords arrive already encrypted — they were encrypted at job-start so
  // that plaintext never rests in the job row.
  if (body.orcanos_db_password_encrypted) {
    row.orcanos_db_password_encrypted = body.orcanos_db_password_encrypted;
  }
  if (body.orcanos_api_password_encrypted) {
    row.orcanos_password_encrypted = body.orcanos_api_password_encrypted;
  }

  const inserted = await pgPost<Array<{ id: string }>>('accounts', row);
  const account = inserted[0];

  // The module licences the create form asked for, applied now that the account
  // and its database both exist. They live in the traceability instance, which
  // shares no transaction with master, so a failure here is reported in the job
  // message rather than failing a job whose real work is done — the account is
  // created either way, and the licences are re-settable from its pills.
  let licenceNote = '';
  const modules = (job.payload as { modules?: Partial<Record<ModuleKey, boolean>> } | null)
    ?.modules;
  if (modules && Object.values(modules).some((v) => v !== undefined)) {
    const tenant = orcanosVirtualDirFromUrl(body.orcanos_api_url || '') || job.account_name;
    try {
      await upsertTraceModules(tenant, modules);
    } catch (e) {
      licenceNote =
        ` — but its module licences were not saved (tenant '${tenant}': ` +
        `${e instanceof Error ? e.message : String(e)}). Set them from the account's pills.`;
    }
  }

  return updateJob(job.id, {
    state: 'done',
    message: `Account created${licenceNote}`,
    account_id: account.id,
    // The job has served its purpose; drop the secrets it was carrying.
    db_password_encrypted: null,
    service_key_encrypted: null,
    payload: null,
  });
}
