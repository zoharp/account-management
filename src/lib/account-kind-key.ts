import type { AccountKind } from './types';

/**
 * Client-safe: which key a merged-list row's Customer/Demo label is stored under — its Orcanos
 * tenant, else its name, lower-cased. The Usage screen's `account` is the same tenant string.
 * Storage: `lib/account-kind.ts` (server only).
 */
export function kindKeyOf(row: { tenant: string | null; account_name: string }): string {
  return (row.tenant || row.account_name).trim().toLowerCase();
}

/** Customer/Demo filter — ONE setting shared by the Accounts and Usage screens. Per browser only. */
export type KindFilter = 'all' | AccountKind;
export const KIND_FILTER_KEY = 'accounts.kindFilter';
export function readKindFilter(): KindFilter {
  try {
    const v = localStorage.getItem(KIND_FILTER_KEY);
    return v === 'customer' || v === 'demo' ? v : 'all';
  } catch {
    return 'all';
  }
}
export function writeKindFilter(v: KindFilter) {
  try { localStorage.setItem(KIND_FILTER_KEY, v); } catch { /* storage blocked — not fatal */ }
}
