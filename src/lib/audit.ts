/**
 * Security-event audit trail — port of `backend/audit_log.py`.
 *
 * Writes to the same master-DB `security_audit_log` table the QMS backend uses,
 * so the two apps produce one continuous trail (ISO 27001:2022 A.8.15 / A.8.16).
 *
 * Best-effort and non-blocking by design: a logging failure must never break
 * the request it is describing.
 */

import { supabaseServiceKey, supabaseUrl } from './env';
import type { PlatformUser } from './types';

export async function logSecurityEvent(
  eventType: string,
  opts: {
    user?: PlatformUser | null;
    accountName?: string | null;
    detail?: Record<string, unknown>;
    success?: boolean;
  } = {},
): Promise<void> {
  const row = {
    event_type: eventType,
    account_name: opts.accountName ?? null,
    actor_user_id: opts.user?.id ?? null,
    actor_email: opts.user?.email ?? null,
    success: opts.success ?? true,
    detail: opts.detail ?? {},
  };

  try {
    const key = supabaseServiceKey();
    const res = await fetch(`${supabaseUrl()}/rest/v1/security_audit_log`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });

    // fetch does NOT throw on 4xx/5xx, so without this check a missing table
    // (PostgREST answers 404 PGRST205) discards every audit write with no error
    // anywhere. That is exactly how this went unnoticed from day one. Still
    // non-blocking — the requirement is that failures are visible, not fatal.
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 300);
      console.error(
        `[audit] '${eventType}' NOT recorded — HTTP ${res.status}: ${body}` +
          (res.status === 404
            ? ' | security_audit_log is missing: apply 009_security_audit_log.sql to the master DB.'
            : ''),
      );
    }
  } catch (e) {
    console.error(`[audit] failed to record '${eventType}':`, e);
  }
}
