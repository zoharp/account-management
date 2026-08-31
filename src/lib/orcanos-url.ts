/**
 * URL normalisation shared by the client forms and the server routes.
 *
 * Deliberately dependency-free and in its own module: the client components
 * need it, and `lib/orcanos.ts` pulls in `node:crypto` through the secret
 * decryption path, which must never reach the browser bundle.
 *
 * Port of the identical `normalizeOrcanosUrl` in QMS's AccountDetail.jsx and
 * CreateAccountModal.jsx.
 */
export function normalizeOrcanosUrl(raw: string): string {
  let url = (raw || '').trim();
  if (!url) return url;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  if (!/\/api\/v2\/Json$/i.test(url.replace(/\/$/, ''))) {
    url = `${url.replace(/\/$/, '')}/api/v2/Json`;
  }
  return url;
}

/**
 * Extract the tenant path segment from a normalised Orcanos API URL —
 * `https://app.orcanos.com/orcanosdemo/api/v2/Json` → `orcanosdemo`. This is
 * what `QW_Login` itself reports as `User_details.Virtual_dir`, and it is NOT
 * the same string as the master-DB `accounts.account_name` / `PLATFORM_ACCOUNT`
 * label that points at that account's row (verified live: the `demo` account's
 * own `orcanos_api_url` has tenant segment `orcanosdemo`, not `demo`). Sign-in
 * pins against this, not against `PLATFORM_ACCOUNT` directly.
 */
export function orcanosVirtualDirFromUrl(raw: string): string | null {
  const url = normalizeOrcanosUrl(raw);
  const m = url.match(/^https?:\/\/[^/]+\/([^/]+)\/api\/v2\/Json$/i);
  return m ? m[1] : null;
}

/**
 * Which tenant a NEW account's traceability licences will be keyed on, and how
 * that was decided.
 *
 * `account_access` is keyed on the Orcanos tenant; master `accounts` has no
 * tenant column, so the URL is the only real source (`lib/modules.ts`). When an
 * account is created without one there is nothing left but the account name —
 * true for every account since the 2026-08-29 rename, and a guess otherwise.
 *
 * The fallback stays, because refusing it would create an account with no
 * allowlist row at all, which is unreachable AND unfixable. What does not stay
 * is it being silent: `from` is rendered in the create form and recorded in the
 * audit event, so a wrong guess is visible at the moment it is made rather than
 * when a customer cannot sign in.
 *
 * Client-safe on purpose — the create form shows the same answer the route will
 * compute.
 */
export function traceTenantForAccount(opts: {
  orcanosApiUrl?: string | null;
  accountName: string;
}): { tenant: string; from: 'url' | 'account_name' } {
  const fromUrl = opts.orcanosApiUrl ? orcanosVirtualDirFromUrl(opts.orcanosApiUrl) : null;
  if (fromUrl) return { tenant: fromUrl, from: 'url' };
  return { tenant: opts.accountName.trim(), from: 'account_name' };
}
