/**
 * AI credit limits — storage and usage reads (SERVER ONLY: uses the master service key).
 * Rules and shapes: `lib/credit-limits-key.ts`.
 *
 * Stored in master `platform_settings` (sql/008, already applied — no migration):
 *   key `credit_limits`           value {"day":1000,"week":3000,"month":10000}   the default for everyone
 *   key `credit_limits:<tenant>`  value {"day":…,"week":…,"month":…}             one account's own limits
 * No own row = the account follows the default, so changing the default reaches it at once.
 * One row per tenant (like `account_kind:<tenant>`) so two people editing different accounts never
 * overwrite each other. Keyed on the TENANT (`kindKeyOf`): most accounts are traceability-only and
 * have no master uuid; Ask Paul derives the same tenant from its account's `orcanos_api_url`.
 *
 * Enforced by Ask Paul (`backend/credit_limits.py`) and traceability (`src/backend/credit_limits.py`),
 * each before every AI call; both read these rows (30 s cache).
 */

import { pgDelete, pgGet, pgUpsert } from './supabase';
import { normaliseKindKey } from './account-kind';
import {
  CREDIT_LIMIT_DEFAULTS,
  CREDIT_PERIODS,
  blockedPeriod,
  parseCreditLimits,
  periodResets,
  periodStarts,
  type CreditLimits,
  type CreditUsage,
} from './credit-limits-key';

export const DEFAULT_KEY = 'credit_limits';
const OWN_PREFIX = 'credit_limits:';

export interface StoredLimits {
  limits: CreditLimits;
  updated_at: string | null;
  updated_by: string | null;
}

type SettingRow = { key: string; value?: unknown; updated_at?: string; updated_by?: string };

export function isMissingTable(e: unknown): boolean {
  return /platform_settings|42P01|PGRST205/i.test(e instanceof Error ? e.message : String(e));
}

export async function getDefaultLimits(): Promise<StoredLimits> {
  const rows = await pgGet<SettingRow[]>(`platform_settings?key=eq.${DEFAULT_KEY}&select=key,value,updated_at,updated_by`);
  const r = rows[0];
  return {
    limits: parseCreditLimits(r?.value, CREDIT_LIMIT_DEFAULTS),
    updated_at: r?.updated_at ?? null,
    updated_by: r?.updated_by ?? null,
  };
}

/** Every account that has its own limits, by lower-cased tenant. */
export async function listOwnLimits(defaults: CreditLimits): Promise<Record<string, StoredLimits>> {
  const rows = await pgGet<SettingRow[]>(
    `platform_settings?key=like.${encodeURIComponent(OWN_PREFIX)}*&select=key,value,updated_at,updated_by`,
  );
  const out: Record<string, StoredLimits> = {};
  for (const r of rows) {
    out[r.key.slice(OWN_PREFIX.length)] = {
      limits: parseCreditLimits(r.value, defaults),
      updated_at: r.updated_at ?? null,
      updated_by: r.updated_by ?? null,
    };
  }
  return out;
}

export async function getOwnLimits(tenant: string, defaults: CreditLimits): Promise<StoredLimits | null> {
  const key = OWN_PREFIX + normaliseKindKey(tenant);
  const rows = await pgGet<SettingRow[]>(
    `platform_settings?key=eq.${encodeURIComponent(key)}&select=key,value,updated_at,updated_by`,
  );
  const r = rows[0];
  return r ? { limits: parseCreditLimits(r.value, defaults), updated_at: r.updated_at ?? null, updated_by: r.updated_by ?? null } : null;
}

export async function setDefaultLimits(limits: CreditLimits, by: string): Promise<void> {
  await pgUpsert('platform_settings', 'key', { key: DEFAULT_KEY, value: limits, updated_at: new Date().toISOString(), updated_by: by });
}

export async function setOwnLimits(tenant: string, limits: CreditLimits, by: string): Promise<void> {
  await pgUpsert('platform_settings', 'key', {
    key: OWN_PREFIX + normaliseKindKey(tenant),
    value: limits,
    updated_at: new Date().toISOString(),
    updated_by: by,
  });
}

/** Back to the default: delete the account's own row. */
export async function clearOwnLimits(tenant: string): Promise<void> {
  await pgDelete(`platform_settings?key=eq.${encodeURIComponent(OWN_PREFIX + normaliseKindKey(tenant))}`);
}

/** Credits per $1 of real cost (credits_per_usd × markup) — the same factor Ask Paul and traceability use. */
export async function creditFactor(): Promise<number> {
  try {
    const s = await pgGet<Array<{ value?: { credits_per_usd?: number; markup?: number } }>>(
      'platform_settings?key=eq.credits&select=value',
    );
    const v = s[0]?.value;
    const per = Number(v?.credits_per_usd) > 0 ? Number(v?.credits_per_usd) : 100;
    const mk = Number(v?.markup) > 0 ? Number(v?.markup) : 1;
    return per * mk;
  } catch {
    return 100;
  }
}

const zero = (): CreditLimits => ({ day: 0, week: 0, month: 0 });

/** Put the two halves together into what every usage screen shows. */
export function buildUsage(
  limits: CreditLimits,
  own: boolean,
  by_app: { ask_paul: CreditLimits; traceability: CreditLimits },
  source: string,
  now = new Date(),
): CreditUsage {
  const used = {
    day: by_app.ask_paul.day + by_app.traceability.day,
    week: by_app.ask_paul.week + by_app.traceability.week,
    month: by_app.ask_paul.month + by_app.traceability.month,
  };
  const r = periodResets(now);
  return {
    limits,
    own,
    used,
    by_app,
    resets_at: { day: r.day.toISOString(), week: r.week.toISOString(), month: r.month.toISOString() },
    blocked: blockedPeriod(limits, used),
    source,
  };
}

/**
 * Ask Paul's usage in credits per period, from the master ledger `account_usage_logs` for one master
 * account. Rows traceability mirrors there (`app_feature` `traceability:*`) are left out — the trace
 * half is read from the trace app's own ledger, which has every row with no mirroring lag.
 */
export async function askPaulUsageFromMaster(accountId: string, now = new Date()): Promise<CreditLimits> {
  const starts = periodStarts(now);
  const from = new Date(Math.min(starts.week.getTime(), starts.month.getTime())).toISOString();
  const usd = zero();
  for (let offset = 0; offset < 100_000; offset += 1000) {
    const page = await pgGet<Array<{ cost_usd?: number | string; created_at?: string; app_feature?: string | null }>>(
      `account_usage_logs?select=cost_usd,created_at,app_feature&account_id=eq.${encodeURIComponent(accountId)}` +
        `&created_at=gte.${encodeURIComponent(from)}&order=created_at.asc&limit=1000&offset=${offset}`,
    );
    for (const r of page) {
      if ((r.app_feature ?? '').startsWith('traceability:')) continue;
      const t = new Date(r.created_at ?? 0).getTime();
      const c = Number(r.cost_usd) || 0;
      for (const { key } of CREDIT_PERIODS) if (t >= starts[key].getTime()) usd[key] += c;
    }
    if (page.length < 1000) break;
  }
  const f = await creditFactor();
  return { day: Math.round(usd.day * f), week: Math.round(usd.week * f), month: Math.round(usd.month * f) };
}
