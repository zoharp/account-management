/**
 * PostgREST access to the MASTER / platform Supabase database.
 *
 * This is the same database the QMS backend calls `SUPABASE_URL` — the one
 * holding `accounts`, `users`, `auth_methods`, `account_usage_logs`,
 * `security_audit_log` and `account_llm_keys`. Per-account (tenant) vector
 * databases are never touched from here; this app only ever reads and writes
 * the control plane.
 *
 * Deliberately plain `fetch` rather than @supabase/supabase-js, mirroring the
 * QMS backend's `req.get(...)` style so the two implementations stay easy to
 * diff against each other.
 */

import { supabaseServiceKey, supabaseUrl } from './env';

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const key = supabaseServiceKey();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

export class PostgrestError extends Error {
  status: number;
  constructor(status: number, body: string) {
    super(`Supabase ${status}: ${body.slice(0, 300)}`);
    this.status = status;
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) throw new PostgrestError(res.status, text);
  if (!text) return [] as unknown as T;
  return JSON.parse(text) as T;
}

/** GET against a PostgREST path, e.g. `accounts?select=id&order=account_name.asc`. */
export async function pgGet<T = unknown[]>(path: string): Promise<T> {
  const res = await fetch(`${supabaseUrl()}/rest/v1/${path}`, {
    headers: headers(),
    cache: 'no-store',
  });
  return parse<T>(res);
}

/** POST a row (or rows). Returns the inserted representation. */
export async function pgPost<T = unknown[]>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${supabaseUrl()}/rest/v1/${path}`, {
    method: 'POST',
    headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  return parse<T>(res);
}

/** PATCH rows matched by the filter in `path`. Returns the updated representation. */
export async function pgPatch<T = unknown[]>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${supabaseUrl()}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  return parse<T>(res);
}

/** DELETE rows matched by the filter in `path`. */
export async function pgDelete(path: string): Promise<void> {
  const res = await fetch(`${supabaseUrl()}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: headers({ Prefer: 'return=minimal' }),
    cache: 'no-store',
  });
  if (!res.ok) throw new PostgrestError(res.status, await res.text());
}

/** Call a Postgres function exposed through PostgREST. */
export async function pgRpc<T = unknown[]>(fn: string, args: unknown = {}): Promise<T> {
  const res = await fetch(`${supabaseUrl()}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(args),
    cache: 'no-store',
  });
  return parse<T>(res);
}

/**
 * Case-insensitive `account_name` filter — port of `account_ci_filter()` in
 * `backend/account_keys.py`. Escapes the LIKE metacharacters so an account
 * named `a_b` cannot match `axb`.
 */
export function accountCiFilter(name: string): string {
  const escaped = name.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  return `ilike.${encodeURIComponent(escaped)}`;
}
