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
