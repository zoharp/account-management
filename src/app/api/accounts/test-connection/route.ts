/**
 * POST /api/accounts/test-connection — test vector DB credentials that have not
 * been saved yet (there is no account row to read them from).
 * Port of `POST /admin/accounts/test-connection`.
 *
 * This is what makes "you must test before saving a new key" enforceable in the
 * detail form: the value being tested is the one typed in the field, not the
 * one already in the database.
 *
 * Next resolves the static `test-connection` segment ahead of the sibling
 * `[id]` segment, so this route is reached rather than `PATCH /accounts/:id`.
 */

import { requirePlatformStaff } from '@/lib/session';
import { testVectorCore } from '@/lib/connections';
import { logSecurityEvent } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: Request) {
  const { user, error } = await requirePlatformStaff();
  if (error) return error;

  const body = (await req.json().catch(() => ({}))) as {
    db_type?: string;
    db_host?: string;
    db_password?: string;
    db_user?: string;
    db_name?: string;
    connection_string?: string;
  };

  if (!body.db_host) return Response.json({ detail: 'Missing: db_host' }, { status: 400 });

  const result = await testVectorCore({
    dbType: body.db_type || 'supabase',
    dbHost: body.db_host,
    dbUser: body.db_user || 'postgres',
    dbName: body.db_name || 'postgres',
    password: body.db_password ?? '',
    connectionString: body.connection_string || '',
  });

  // Nothing is decrypted here — the credential is the one just typed. It is
  // still recorded, because this test IS the gate for saving a new vector key:
  // without it the trail would show a key appearing with no evidence anyone
  // checked it first. Same event type as the saved-credential test, told apart
  // by `stored: false` and a null account_id.
  await logSecurityEvent('account_credentials_tested', {
    user,
    detail: { account_id: null, stored: false, target: 'vector_db', host: body.db_host },
    success: result.success === true,
  });

  return Response.json(result);
}
