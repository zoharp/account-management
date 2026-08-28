/**
 * Orcanos REST API helpers — the credential test behind the "Test API" button.
 *
 * Ports `_normalize_orcanos_url`, the `_is_safe_external_url` SSRF guard and the
 * `QW_Login` call from `POST /orcanos/proxy/login` in `backend/api.py`.
 *
 * The security property being preserved: when the caller does NOT supply a
 * password, we fall back to the account's stored credential AND pin the URL to
 * the account's own stored `orcanos_api_url`. A decrypted saved password is
 * therefore never forwarded to a host chosen by the client.
 */

import { decryptSecret } from './crypto';
import { normalizeOrcanosUrl } from './orcanos-url';

// Re-exported so server-side callers have a single import for Orcanos helpers.
// Client components must import it from './orcanos-url' directly — this module
// reaches node:crypto and cannot be bundled for the browser.
export { normalizeOrcanosUrl };

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  '169.254.169.254',
]);

/**
 * Reject anything that is not a plain public https/http URL. Port of
 * `_is_safe_external_url` — blocks loopback, link-local, and the cloud
 * metadata endpoints so this route cannot be used to probe internal networks.
 */
export function isSafeExternalUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;

  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) return false;
  if (host.endsWith('.localhost') || host.endsWith('.internal')) return false;

  // Literal IPv4 in a private / loopback / link-local range
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
  }

  // IPv6 loopback / unique-local / link-local
  if (host === '::1' || host.startsWith('[::1]')) return false;
  if (/^\[?f[cd][0-9a-f]{2}:/i.test(host)) return false;
  if (/^\[?fe80:/i.test(host)) return false;

  return true;
}

export interface OrcanosLoginResult {
  ok: boolean;
  projectCount: number;
  error?: string;
}

/**
 * Call `QW_Login` with HTTP Basic and report how many projects came back —
 * which is what the UI turns into "Connected — N projects found".
 */
export async function orcanosTestLogin(params: {
  apiUrl: string;
  username: string;
  password?: string;
  /** Account row, used only when `password` is absent. */
  account?: Record<string, unknown> | null;
}): Promise<OrcanosLoginResult> {
  let apiUrl = normalizeOrcanosUrl(params.apiUrl);
  let username = params.username;
  let password = params.password;

  // No password typed → fall back to the stored credential, and pin the URL to
  // the account's own so a saved secret can't be aimed at an arbitrary host.
  if (!password) {
    const acct = params.account;
    if (!acct) return { ok: false, projectCount: 0, error: 'No password supplied and no saved credential' };
    const enc = typeof acct.orcanos_password_encrypted === 'string' ? acct.orcanos_password_encrypted : '';
    if (!enc) return { ok: false, projectCount: 0, error: 'No saved API password for this account' };
    password = decryptSecret(enc);
    username = username || String(acct.orcanos_username ?? '');
    apiUrl = normalizeOrcanosUrl(String(acct.orcanos_api_url ?? ''));
  }

  if (!apiUrl) return { ok: false, projectCount: 0, error: 'No Orcanos REST API URL configured' };
  if (!isSafeExternalUrl(apiUrl)) {
    return { ok: false, projectCount: 0, error: 'API URL is not an allowed external address' };
  }

  const basic = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');

  try {
    const res = await fetch(`${apiUrl.replace(/\/$/, '')}/QW_Login`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/json',
      },
      // QW_Login takes no body at all — not even `{}`.
      signal: AbortSignal.timeout(20000),
      cache: 'no-store',
    });

    const text = await res.text();
    if (!res.ok) {
      return { ok: false, projectCount: 0, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }

    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, projectCount: 0, error: `Unparseable response: ${text.slice(0, 200)}` };
    }

    if (data.IsSuccess === false) {
      return { ok: false, projectCount: 0, error: String(data.Message ?? 'Login rejected') };
    }

    return { ok: true, projectCount: countProjects(data) };
  } catch (e) {
    return { ok: false, projectCount: 0, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
  }
}

/**
 * Orcanos wraps XML arrays, so `Data.Projects` arrives either as a plain array
 * or as `{ Project: [...] }` (and as a single object when there is exactly one).
 * Handle all three rather than assuming — the QMS backend learned this the hard
 * way; see the `orcanos-api` skill.
 */
function countProjects(data: Record<string, unknown>): number {
  const inner = (data.Data ?? data) as Record<string, unknown>;
  const projects = inner?.Projects ?? (data as Record<string, unknown>).projects;
  if (!projects) return 0;
  if (Array.isArray(projects)) return projects.length;
  if (typeof projects === 'object') {
    const wrapped = (projects as Record<string, unknown>).Project;
    if (Array.isArray(wrapped)) return wrapped.length;
    if (wrapped) return 1;
  }
  return 0;
}
