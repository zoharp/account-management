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
 * Resolve a hostname to a dotted-quad IPv4 string if it *is* one, including the
 * IPv4-mapped IPv6 spellings.
 *
 * `new URL()` already normalises the decimal / octal / short forms
 * (`2130706433`, `0177.0.0.1`, `127.1` all become `127.0.0.1`), so those need no
 * handling here. What it does NOT collapse is `[::ffff:127.0.0.1]`, which it
 * normalises to the hex form `[::ffff:7f00:1]` — a spelling that slipped past
 * the plain dotted-quad regex and reached the private ranges below unchecked.
 */
function asIpv4(host: string): string | null {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host;

  const inner = host.replace(/^\[/, '').replace(/\]$/, '');

  // ::ffff:7f00:1  (what URL normalisation produces)
  const hex = inner.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');
  }

  // ::ffff:127.0.0.1  (the literal form, in case it survives unnormalised)
  const dotted = inner.match(/^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i);
  return dotted ? dotted[1] : null;
}

/** Loopback, private, link-local, CGNAT, benchmarking and multicast space. */
function isPrivateIpv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmarking
  if (a >= 224) return true; // multicast + reserved
  return false;
}

/**
 * Reject anything that is not a plain public https/http URL. Port of
 * `_is_safe_external_url` — blocks loopback, link-local, and the cloud
 * metadata endpoints so this route cannot be used to probe internal networks.
 *
 * Residual limits, both accepted (SECURITY.md §5): it does not resolve DNS, so
 * a public name pointing at a private address still passes; and it inspects
 * only the URL given, not any host a 3xx later redirects to. Egress filtering
 * is the control for both.
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

  // Literal IPv4 — including the IPv4-mapped IPv6 spellings of one.
  const v4 = asIpv4(host);
  if (v4 && isPrivateIpv4(v4)) return false;

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

export interface OrcanosIdentity {
  ok: boolean;
  username?: string;
  displayName?: string;
  /** `User_details.Virtual_dir` — the Orcanos tenant this credential belongs to. */
  virtualDir?: string;
  isAdmin?: boolean;
  error?: string;
}

/**
 * Call `QW_Login` as an identity check for platform sign-in — port of the
 * gate in CLAUDE.md "Planned: Orcanos sign-in". Distinct from
 * {@link orcanosTestLogin}: that one is the "Test API" button and only counts
 * projects; this one is on the sign-in path and extracts `User_details` so the
 * caller can enforce `Virtual_dir === PLATFORM_ACCOUNT` and `Is_admin`.
 *
 * Never falls back to a stored credential — sign-in always uses the password
 * the caller just typed, against the platform account's own `orcanos_api_url`.
 */
export async function qwLoginIdentity(
  rawApiUrl: string,
  username: string,
  password: string,
): Promise<OrcanosIdentity> {
  const apiUrl = normalizeOrcanosUrl(rawApiUrl);
  if (!apiUrl) return { ok: false, error: 'No Orcanos REST API URL configured for the platform account' };
  if (!isSafeExternalUrl(apiUrl)) {
    return { ok: false, error: 'API URL is not an allowed external address' };
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
    if (res.status === 401) return { ok: false, error: 'Invalid Orcanos credentials' };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };

    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, error: `Unparseable response: ${text.slice(0, 200)}` };
    }

    if (data.IsSuccess === false) {
      return { ok: false, error: String(data.Message ?? 'Login rejected') };
    }

    const details = ((data.Data as Record<string, unknown> | undefined)?.User_details ??
      {}) as Record<string, unknown>;

    return {
      ok: true,
      username: String(details.User_name ?? ''),
      displayName: String(details.Display_name ?? ''),
      virtualDir: String(details.Virtual_dir ?? ''),
      isAdmin: isAdminFlag(details.Is_admin),
    };
  } catch (e) {
    return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
  }
}

/** Tolerant read of `User_details.Is_admin` — Orcanos may send `1`, `"1"`, `"true"` or `"Y"`. */
function isAdminFlag(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1;
  if (typeof v === 'string') return ['1', 'true', 'yes', 'y'].includes(v.trim().toLowerCase());
  return false;
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
