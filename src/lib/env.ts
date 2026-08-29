/**
 * Environment access, centralised so a missing variable fails with a message
 * that names the variable rather than with `undefined` three layers down.
 *
 * Port of the parts of `backend/config.py` this app needs. Like the QMS
 * backend, secrets are read at call time rather than cached at module load,
 * so a Vercel env change takes effect on the next cold start without any
 * stale-constant surprises.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not configured. Set it in .env.local (local) or the Vercel project settings (deployed).`,
    );
  }
  return value;
}

export const supabaseUrl = () => required('SUPABASE_URL').replace(/\/$/, '');
export const supabaseServiceKey = () => required('SUPABASE_SERVICE_KEY');
export const jwtSecret = () => required('JWT_SECRET');
export const encryptionKey = () => required('ENCRYPTION_KEY');

export const supabaseOrgAccessToken = () =>
  process.env.SUPABASE_ORG_ACCESS_TOKEN ||
  (() => {
    throw new Error(
      'SUPABASE_ORG_ACCESS_TOKEN is not configured — generate a Personal Access Token in ' +
        'Supabase Dashboard > Account > Access Tokens and set it in the environment.',
    );
  })();

export const supabaseOrgId = () => required('SUPABASE_ORG_ID');
export const projectRegion = () => process.env.SUPABASE_PROJECT_REGION || 'us-east-1';

/** Only `@{domain}` users with role='admin' may use this app. */
export const platformEmailDomain = () => process.env.PLATFORM_EMAIL_DOMAIN || 'orcanos.com';

/** The account whose `auth_methods` row drives the login screen. */
export const platformAccount = () => process.env.PLATFORM_ACCOUNT || 'orcanos';

/**
 * Office 365 sign-in — **disabled in code, on purpose (2026-08-29).**
 *
 * Not an env var, because this is not a deployment choice: the route is unsafe
 * as written and must not come back by someone flipping `office365_enabled` in
 * the master DB and forgetting why it was off. It is finding A-1 in
 * `SECURITY_AUDIT_2026-08-29.md`, and in one line:
 *
 *   `config.office365_tenant || 'common'` accepts an authorization code from
 *   ANY Microsoft tenant, nothing verifies the token's `tid`, and the identity
 *   is taken from Graph's `mail` — a free-text directory attribute that an
 *   attacker sets to whatever they like in a tenant they administer. Set it to
 *   a known staff address and the `@orcanos.com` half of the platform gate
 *   passes on the attacker's own assertion.
 *
 * Google and Orcanos email sign-in are unaffected; each method is independent.
 *
 * BEFORE setting this to `true`: pin `auth_methods.office365_tenant` to the real
 * Entra tenant GUID and refuse `common`, verify `tid` and `iss` from the
 * `id_token`, and prefer `userPrincipalName` over `mail`. All three, not one.
 */
export const office365SignInEnabled = (): boolean => false;

/**
 * The traceability-matrix instance whose `/api/admin/*` endpoints back the
 * Traceability and Training module licences.
 *
 * This is the ONLY thing that decides which SQLite the modules come from:
 * `http://127.0.0.1:8010` talks to the local backend and its own database file,
 * the Fly URL talks to the production volume. There is no direct-database mode
 * — Vercel cannot reach either file. See `lib/trace.ts`.
 *
 * 8010, not 8000: traceability-matrix moved its dev ports to 8010/3010 because
 * Orcanos QMS and quiz-management use 8000/3000. Pointing at 8000 reaches the
 * QMS backend, which has no `/api/admin/*` and answers 404 to the login.
 */
export const traceApiUrl = () => required('TRACE_API_URL').replace(/\/$/, '');

/**
 * The shared admin password of that instance (its `ADMIN_PASSWORD`). A local
 * dev instance normally leaves it unset, in which case it is the documented
 * default; Fly has a real secret. Deliberately not defaulted here — a silent
 * fallback to the well-known default would be an easy way to point at
 * production and be surprised.
 */
export const traceAdminPassword = () => required('TRACE_ADMIN_PASSWORD');

/**
 * Absolute origin of this deployment, for building the OAuth `redirect_uri`.
 * The redirect_uri must match byte-for-byte between the authorize call and the
 * token exchange, so both sides derive it from here.
 */
export function appOrigin(req?: Request): string {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (req) return new URL(req.url).origin;
  return 'http://localhost:3100';
}
