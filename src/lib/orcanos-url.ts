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
