/**
 * GET    /api/accounts/:id  — one account, non-secret columns only.
 * PATCH  /api/accounts/:id  — update, encrypting any supplied secret.
 * DELETE /api/accounts/:id  — delete, plus the name-keyed rows that have no FK.
 *
 * Ports `GET|PATCH|DELETE /admin/accounts/{account_id}` from backend/api.py.
 */

import { requirePlatformStaff } from '@/lib/session';
import { pgDelete, pgGet, pgPatch } from '@/lib/supabase';
import { encryptSecret } from '@/lib/crypto';
import { logSecurityEvent } from '@/lib/audit';
import { hasAskPaulDatabase } from '@/lib/modules';
import type { AccountRow, LlmKeyStatus } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The exact column list from the QMS endpoint. It contains ZERO `*_encrypted`
 * columns and that is load-bearing: no ciphertext, and therefore nothing to
 * attack offline, ever reaches the browser. Add columns here only after
 * checking they are not secret.
 */
const SAFE_COLUMNS = [
  'id',
  'account_name',
  'db_type',
  'db_host',
  'db_name',
  'db_user',
  'connection_string',
  'is_active',
  'created_at',
  'updated_at',
  'orcanos_db_type',
  'orcanos_db_host',
  'orcanos_db_name',
  'orcanos_db_user',
  'orcanos_connection_string',
  'orcanos_api_url',
  'orcanos_username',
  'vector_db_type',
  'vector_db_host',
  'vector_db_name',
  'vector_db_user',
  'vector_connection_string',
].join(',');

/** Plaintext fields a PATCH may set. `account_name` is deliberately absent. */
const PATCHABLE = [
  'db_type',
  'db_host',
  'db_name',
  'db_user',
  'is_active',
  'orcanos_db_type',
  'orcanos_db_host',
  'orcanos_db_name',
  'orcanos_db_user',
  'orcanos_api_url',
  'orcanos_username',
  'vector_db_type',
  'vector_db_host',
  'vector_db_name',
  'vector_db_user',
] as const;

/** Request field → encrypted column. */
const SECRET_FIELDS: Record<string, string> = {
  db_password: 'db_password_encrypted',
  orcanos_db_password: 'orcanos_db_password_encrypted',
  orcanos_api_password: 'orcanos_password_encrypted',
  vector_db_password: 'vector_db_password_encrypted',
};

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { error } = await requirePlatformStaff();
  if (error) return error;

  const { id } = await ctx.params;
  const rows = await pgGet<AccountRow[]>(
    `accounts?id=eq.${encodeURIComponent(id)}&select=${SAFE_COLUMNS}`,
  );
  if (!rows.length) return Response.json({ detail: 'Account not found' }, { status: 404 });
  const account = rows[0];

  // LLM key status only — never the key itself.
  let llmKey: LlmKeyStatus | null = null;
  try {
    const keys = await pgGet<LlmKeyStatus[]>(
      `account_llm_keys?account_name=eq.${encodeURIComponent(account.account_name)}` +
        `&select=id,engine,expires_at,last_test_status,last_test_error,updated_at`,
    );
    llmKey = keys[0] ?? null;
  } catch (e) {
    console.error('[GET /api/accounts/:id] llm key lookup failed:', e);
  }

  return Response.json({ account, llm_key: llmKey });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { user, error } = await requirePlatformStaff();
  if (error) return error;

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const patch: Record<string, unknown> = {};
  for (const field of PATCHABLE) {
    if (field in body) patch[field] = body[field];
  }
  const secretsChanged: string[] = [];
  for (const [field, column] of Object.entries(SECRET_FIELDS)) {
    const value = body[field];
    // An empty string means "leave the stored secret alone" — matches the
    // "Leave blank to keep current" placeholder in the form.
    if (typeof value === 'string' && value) {
      patch[column] = encryptSecret(value);
      secretsChanged.push(field);
    }
  }

  if (!Object.keys(patch).length) return Response.json({ detail: 'Nothing to update' }, { status: 400 });

  // ── Activating is activating Ask Paul ───────────────────────────────────
  //
  // `is_active` is not an account-level gate and never was: it is read in
  // exactly two places, both inside the QMS AI backend, and traceability never
  // reads it at all (lib/modules.ts). It is Ask Paul's kill switch — which makes
  // this switch a fourth way to turn Ask Paul on, alongside the create form, the
  // list pill and the traceability dialog. It gets the same rule: not without a
  // database (`ASK_PAUL_NEEDS_DB`).
  //
  // Evaluated against the row this PATCH *produces*, not the stored one, so
  // entering the vector host and flipping the switch in one save is allowed —
  // that is the normal way an account gets its database. Only a transition to
  // active is checked; an already-active row can always be saved, and
  // deactivating is never blocked.
  if (patch.is_active === true) {
    const current = await pgGet<
      Array<{ is_active: boolean; db_host: string | null; vector_db_host: string | null }>
    >(`accounts?id=eq.${encodeURIComponent(id)}&select=is_active,db_host,vector_db_host`);
    const before = current[0];
    if (before && !before.is_active) {
      const after = {
        db_host: 'db_host' in patch ? (patch.db_host as string | null) : before.db_host,
        vector_db_host:
          'vector_db_host' in patch
            ? (patch.vector_db_host as string | null)
            : before.vector_db_host,
      };
      if (!hasAskPaulDatabase(after)) {
        return Response.json(
          {
            detail:
              'Active is Ask Paul’s kill switch, and Ask Paul needs a database. ' +
              'Fill in the Vector DB section below before activating this account.',
          },
          { status: 409 },
        );
      }
    }
  }

  try {
    const rows = await pgPatch<AccountRow[]>(`accounts?id=eq.${encodeURIComponent(id)}`, patch);
    const updated = rows[0];

    await logSecurityEvent('account_updated', {
      user,
      accountName: updated?.account_name,
      detail: {
        account_id: id,
        fields: Object.keys(patch).filter((k) => !k.endsWith('_encrypted')),
        secrets_rotated: secretsChanged,
      },
    });

    // Mirror the QMS response: the updated row, or a bare status if PostgREST
    // returned nothing (it does that when the filter matched no rows).
    return Response.json(updated ?? { status: 'updated' });
  } catch (e) {
    return Response.json(
      { detail: `DB error: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { user, error } = await requirePlatformStaff();
  if (error) return error;

  const { id } = await ctx.params;

  const rows = await pgGet<Array<{ account_name: string }>>(
    `accounts?id=eq.${encodeURIComponent(id)}&select=account_name`,
  );
  const accountName = rows[0]?.account_name ?? null;

  // account_llm_keys and auth_methods are keyed by account_name with no FK to
  // accounts.id, so deleting the account alone would strand two rows of
  // encrypted secrets. See MD files/SECURITY_FIXES.md (ISO3) in the QMS repo.
  if (accountName) {
    const filter = `?account_name=eq.${encodeURIComponent(accountName)}`;
    await pgDelete(`account_llm_keys${filter}`).catch((e) =>
      console.error('[DELETE account] llm key cleanup failed:', e),
    );
    await pgDelete(`auth_methods${filter}`).catch((e) =>
      console.error('[DELETE account] auth_methods cleanup failed:', e),
    );
  }

  await pgDelete(`accounts?id=eq.${encodeURIComponent(id)}`);
  await logSecurityEvent('account_deleted', {
    user,
    accountName,
    detail: { account_id: id },
  });

  return Response.json({
    success: true,
    warning:
      "This account's provisioned Supabase project (vector DB — all documents, chat " +
      'history, usage logs for this tenant) was NOT deleted. De-provision it manually ' +
      'via the Supabase dashboard if this tenant\'s data must be fully purged.',
  });
}
