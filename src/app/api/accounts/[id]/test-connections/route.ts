/**
 * POST /api/accounts/:id/test-connections — test both saved connections.
 * Port of `POST /admin/accounts/{account_id}/test-connections`.
 *
 * `{success: null, message: "Not configured"}` for a connection that has
 * nothing to test — the UI renders that as a neutral note rather than a failure.
 */

import { requirePlatformStaff } from '@/lib/session';
import { pgGet } from '@/lib/supabase';
import { testOrcanosConnection, testVectorConnection } from '@/lib/connections';
import { logSecurityEvent } from '@/lib/audit';
import type { ConnectionTestResult } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const COLUMNS = [
  'orcanos_db_type',
  'orcanos_db_host',
  'orcanos_db_name',
  'orcanos_db_user',
  'orcanos_db_password_encrypted',
  'orcanos_connection_string',
  'vector_db_type',
  'vector_db_host',
  'vector_db_name',
  'vector_db_user',
  'vector_db_password_encrypted',
  'vector_connection_string',
].join(',');

const NOT_CONFIGURED: ConnectionTestResult = { success: null, message: 'Not configured' };

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, error } = await requirePlatformStaff();
  if (error) return error;

  const { id } = await ctx.params;
  const rows = await pgGet<Array<Record<string, unknown>>>(
    `accounts?id=eq.${encodeURIComponent(id)}&select=${COLUMNS}`,
  );
  if (!rows.length) return Response.json({ detail: 'Account not found' }, { status: 404 });
  const row = rows[0];

  const hasOrcanos = Boolean(row.orcanos_db_host || row.orcanos_connection_string);
  const hasVector = Boolean(row.vector_db_host || row.vector_connection_string);

  // Run both concurrently — each has its own 6s budget, so a serial pair would
  // double the worst case for no reason.
  const [orcanos, vector] = await Promise.all([
    hasOrcanos ? testOrcanosConnection(row) : Promise.resolve(NOT_CONFIGURED),
    hasVector ? testVectorConnection(row) : Promise.resolve(NOT_CONFIGURED),
  ]);

  // Both tests DECRYPT stored database credentials to use them. That is secret
  // access, and it is exactly what an auditor means by "key access" — so it is
  // recorded even though nothing was changed. `success` is false if either
  // configured connection failed; a connection with nothing to test is neither.
  await logSecurityEvent('account_credentials_tested', {
    user,
    detail: {
      account_id: id,
      orcanos: hasOrcanos ? (orcanos.success ? 'ok' : 'failed') : 'not_configured',
      vector: hasVector ? (vector.success ? 'ok' : 'failed') : 'not_configured',
    },
    success: (!hasOrcanos || orcanos.success === true) && (!hasVector || vector.success === true),
  });

  return Response.json({ orcanos, vector });
}
