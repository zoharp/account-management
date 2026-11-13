/**
 * AI credit limits — client-safe shapes and rules (no secrets, no fetch).
 * Storage and server reads: `lib/credit-limits.ts`.
 *
 * Three limits per account, in credits: daily, weekly, monthly. 0 = no limit for that period.
 * Any one reached blocks AI in Ask Paul AND Traceability until that period resets.
 * Periods are calendar periods in UTC: day from 00:00, week from Monday 00:00, month from the 1st.
 *
 * Defaults (1000 / 3000 / 10000) are mirrored in Ask Paul (`CREDIT_LIMIT_DEFAULTS`, backend/credit_limits.py)
 * and traceability (`CREDIT_LIMIT_DEFAULTS`, src/backend/credit_limits.py) — change all three together.
 */

export type CreditPeriod = 'day' | 'week' | 'month';
export type CreditLimits = Record<CreditPeriod, number>;

export const CREDIT_PERIODS: readonly { key: CreditPeriod; label: string; title: string }[] = [
  { key: 'day', label: 'Daily', title: 'Today' },
  { key: 'week', label: 'Weekly', title: 'This week' },
  { key: 'month', label: 'Monthly', title: 'This month' },
];

export const CREDIT_LIMIT_DEFAULTS: CreditLimits = { day: 1000, week: 3000, month: 10000 };

/** Upper bound on any one limit — stops a typo (an extra few zeros) becoming "unlimited". */
export const CREDIT_LIMIT_MAX = 100_000_000;

/** Coerce stored/posted JSON into limits; anything missing or invalid takes `fallback`'s value. */
export function parseCreditLimits(v: unknown, fallback: CreditLimits = CREDIT_LIMIT_DEFAULTS): CreditLimits {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const out = { ...fallback };
  for (const { key } of CREDIT_PERIODS) {
    const n = Number(o[key]);
    if (o[key] !== undefined && o[key] !== null && Number.isFinite(n) && n >= 0 && n <= CREDIT_LIMIT_MAX) {
      out[key] = Math.round(n);
    }
  }
  return out;
}

/** Strict version for writes: every period present, a whole number 0…MAX. Returns an error message or the limits. */
export function validateCreditLimits(v: unknown): CreditLimits | string {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const out = {} as CreditLimits;
  for (const { key, label } of CREDIT_PERIODS) {
    const n = Number(o[key]);
    if (o[key] === undefined || o[key] === null || o[key] === '' || !Number.isFinite(n) || n < 0 || n > CREDIT_LIMIT_MAX) {
      return `${label} limit must be a number from 0 (no limit) to ${CREDIT_LIMIT_MAX.toLocaleString('en-US')}.`;
    }
    out[key] = Math.round(n);
  }
  return out;
}

export function sameLimits(a: CreditLimits, b: CreditLimits): boolean {
  return CREDIT_PERIODS.every(({ key }) => a[key] === b[key]);
}

/** Start of each period (UTC) that contains `now`. */
export function periodStarts(now = new Date()): Record<CreditPeriod, Date> {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const week = new Date(day);
  week.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7)); // back to Monday
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { day, week, month };
}

/** When each period next resets (UTC). */
export function periodResets(now = new Date()): Record<CreditPeriod, Date> {
  const s = periodStarts(now);
  const day = new Date(s.day);
  day.setUTCDate(day.getUTCDate() + 1);
  const week = new Date(s.week);
  week.setUTCDate(week.getUTCDate() + 7);
  const month = new Date(Date.UTC(s.month.getUTCFullYear(), s.month.getUTCMonth() + 1, 1));
  return { day, week, month };
}

/** What the usage endpoints return — the same shape in all three apps. */
export interface CreditUsage {
  limits: CreditLimits;
  /** true = this account has its own limits; false = it follows the default. */
  own: boolean;
  used: CreditLimits;
  /** Split of `used` by app. */
  by_app: { ask_paul: CreditLimits; traceability: CreditLimits };
  resets_at: Record<CreditPeriod, string>;
  /** The first period whose limit is reached, or null. */
  blocked: CreditPeriod | null;
  /** Where the numbers came from, for the staff screen. */
  source?: string;
}

export function blockedPeriod(limits: CreditLimits, used: CreditLimits): CreditPeriod | null {
  for (const { key } of CREDIT_PERIODS) if (limits[key] > 0 && used[key] >= limits[key]) return key;
  return null;
}

export function fmtCredits(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}
