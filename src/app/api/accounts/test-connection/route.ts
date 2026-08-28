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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: Request) {
  const { error } = await requirePlatformStaff();
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

  return Response.json(result);
}
