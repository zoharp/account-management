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
