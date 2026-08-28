/**
 * Connection tests — port of `backend/connections.py` and
 * `_test_connection_core` from `backend/api.py`.
 *
 * DEVIATION FROM THE PYTHON, deliberate and worth knowing about:
 * the QMS backend reaches SQL Server through `pyodbc` + the "ODBC Driver 17 for
 * SQL Server", a system library that does not exist on Vercel. This port uses
 * `mssql` (tedious), a pure-JS TDS driver, which needs no system driver.
 * Consequences:
 *   - A stored `orcanos_connection_string` in ODBC `KEY=VALUE;` form is parsed
 *     into components here rather than handed to a driver verbatim.
 *   - Results are equivalent but error text differs from the ODBC wording.
 *   - Network reachability differs: a customer SQL Server firewalled to the
 *     Cloud Run egress IPs will refuse Vercel. That is an infrastructure
 *     question, not a code one — see README "Known deltas".
 */

import type { ConnectionTestResult } from './types';
import { decryptSecret } from './crypto';

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function truncate(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 300);
}

/**
 * Test vector DB credentials directly from supplied values (no account row).
 * Port of `_test_connection_core`.
 */
export async function testVectorCore(params: {
  dbType: string;
  dbHost: string;
  dbUser?: string;
  dbName?: string;
  password: string;
  connectionString?: string;
}): Promise<ConnectionTestResult> {
  const { dbType, dbHost, password } = params;
  try {
    if (dbType === 'supabase') {
      const res = await fetch(`${dbHost.replace(/\/$/, '')}/rest/v1/`, {
        headers: { apikey: password, Authorization: `Bearer ${password}` },
        signal: AbortSignal.timeout(6000),
        cache: 'no-store',
      });
      if (res.status >= 400) {
        throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
    } else {
      const user = params.dbUser || 'postgres';
      const name = params.dbName || 'postgres';
      const connStr =
        params.connectionString ||
        `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${dbHost}/${name}`;

      const { Client } = await import('pg');
      const client = new Client({ connectionString: connStr, connectionTimeoutMillis: 6000 });
      await client.connect();
      await client.end();
    }
    return { success: true, message: 'Connected' };
  } catch (e) {
    return { success: false, error: truncate(e) };
  }
}

/** Test the vector DB using the credentials stored on an account row. */
export async function testVectorConnection(
  account: Record<string, unknown>,
): Promise<ConnectionTestResult> {
  try {
    const dbType = str(account.vector_db_type) || 'supabase';
    const host = str(account.vector_db_host);
    if (!host) return { success: false, error: 'No Vector DB host / URL configured' };

    const enc = str(account.vector_db_password_encrypted);
    const password = enc ? decryptSecret(enc) : '';

    return await testVectorCore({
      dbType,
      dbHost: host,
      dbUser: str(account.vector_db_user),
      dbName: str(account.vector_db_name),
      password,
      connectionString: str(account.vector_connection_string).trim(),
    });
  } catch (e) {
    return { success: false, error: truncate(e) };
  }
}

/**
 * Parse an ODBC-style connection string (`DRIVER={...};SERVER=host,1433;...`)
 * into the fields the tedious driver needs. Unknown keys are ignored.
 */
function parseOdbc(connStr: string): {
  server?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
} {
  const out: Record<string, string> = {};
  for (const part of connStr.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toUpperCase();
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('{') && value.endsWith('}')) value = value.slice(1, -1);
    out[key] = value;
  }

  let server = out.SERVER || out.ADDRESS || out.ADDR || out['DATA SOURCE'];
  let port: number | undefined;
  if (server) {
    // SQL Server writes host,port with a comma; tedious wants them separate.
    const comma = server.lastIndexOf(',');
    if (comma > -1 && /^\d+$/.test(server.slice(comma + 1))) {
      port = Number(server.slice(comma + 1));
      server = server.slice(0, comma);
    }
  }

  return {
    server,
    port,
    database: out.DATABASE || out['INITIAL CATALOG'],
    user: out.UID || out['USER ID'],
    password: out.PWD || out.PASSWORD,
  };
}

/** Test the customer's Orcanos SQL Server. Port of `test_orcanos_connection`. */
export async function testOrcanosConnection(
  account: Record<string, unknown>,
): Promise<ConnectionTestResult> {
  try {
    const connStr = str(account.orcanos_connection_string).trim();
    const enc = str(account.orcanos_db_password_encrypted);
    const storedPassword = enc ? decryptSecret(enc) : '';

    let server: string | undefined;
    let port = 1433;
    let database: string | undefined;
    let user: string | undefined;
    let password = storedPassword;

    if (connStr) {
      const parsed = parseOdbc(connStr);
      server = parsed.server;
      port = parsed.port ?? 1433;
      database = parsed.database;
      user = parsed.user;
      if (parsed.password) password = parsed.password;
    } else {
      server = str(account.orcanos_db_host);
      database = str(account.orcanos_db_name);
      user = str(account.orcanos_db_user);
    }

    if (!server) return { success: false, error: 'No Orcanos DB host configured' };

    const mssql = (await import('mssql')).default;
    const pool = new mssql.ConnectionPool({
      server,
      port,
      database: database || undefined,
      user: user || undefined,
      password,
      connectionTimeout: 6000,
      requestTimeout: 6000,
      pool: { max: 1, min: 0, idleTimeoutMillis: 1000 },
      options: {
        // Azure SQL and most hosted Orcanos instances require TLS; self-signed
        // certificates are common on on-prem boxes, so trust rather than fail.
        encrypt: true,
        trustServerCertificate: true,
      },
    });

    try {
      await pool.connect();
    } finally {
      await pool.close().catch(() => {});
    }

    return { success: true, message: 'Connected' };
  } catch (e) {
    return { success: false, error: truncate(e) };
  }
}
