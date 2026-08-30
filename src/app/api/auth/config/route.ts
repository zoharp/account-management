/**
 * GET /api/auth/config — which sign-in methods the login screen should offer.
 *
 * Public and pre-login, like the QMS `GET /auth/config`. The difference is that
 * QMS takes `?account=` from the user (they type their tenant name first); this
 * app is single-tenant by definition — it is the platform's own console — so the
 * account is fixed by PLATFORM_ACCOUNT and never client-supplied.
 *
 * Client secrets are never included; only the public `client_id` and tenant,
 * which the browser needs to build the authorize URL.
 */

import { office365SignInEnabled, orcanosLoginUrl, platformAccount } from '@/lib/env';
import { getAuthMethodsConfig } from '@/lib/users';
import type { AuthMethodOption } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const account = platformAccount();

  let config;
  try {
    config = await getAuthMethodsConfig(account);
  } catch (e) {
    return Response.json(
      { detail: `Could not read auth configuration: ${e instanceof Error ? e.message : e}` },
      { status: 500 },
    );
  }

  if (!config) {
    return Response.json(
      {
        detail:
          `No auth_methods row for account '${account}'. Add one to the master database, ` +
          `or point PLATFORM_ACCOUNT at the account that has one.`,
      },
      { status: 404 },
    );
  }

  const methods: AuthMethodOption[] = [];
  if (config.google_enabled) {
    methods.push({ type: 'google', client_id: config.google_client_id ?? undefined });
  }
  // `office365_enabled` in the master DB is no longer sufficient — the method is
  // off in code (`lib/env.ts`, finding A-1). Both have to be true for the button
  // to appear, and the route refuses regardless of what this returns.
  if (config.office365_enabled && office365SignInEnabled()) {
    methods.push({
      type: 'office365',
      client_id: config.office365_client_id ?? undefined,
      tenant: config.office365_tenant ?? 'common',
    });
  }
  if (config.local_enabled) {
    methods.push({ type: 'local', password_policy: config.password_policy ?? undefined });
  }

  // What the sign-in form's Orcanos URL box starts out holding. Not a secret
  // and not a control — the route accepts any URL the caller sends, this only
  // saves them typing the usual one. See SECURITY.md §9.2.
  return Response.json({
    account_name: account,
    methods,
    default_orcanos_url: orcanosLoginUrl(),
  });
}
