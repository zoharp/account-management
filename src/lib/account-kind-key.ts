import type { AccountKind } from './types';

/** Every type, in display order. Adding one: here + `AccountKind` in types.ts + a `.acl-kind--<key>` colour. */
export const ACCOUNT_KINDS: readonly { key: AccountKind; label: string; plural: string }[] = [
  { key: 'customer', label: 'Customer', plural: 'Customers' },
  { key: 'partner', label: 'Partner', plural: 'Partners' },
  { key: 'demo', label: 'Demo', plural: 'Demo' },
  { key: 'sandbox', label: 'Sandbox', plural: 'Sandbox' },
];

export function isAccountKind(v: unknown): v is AccountKind {
  return ACCOUNT_KINDS.some((k) => k.key === v);
}

export function kindLabel(k: AccountKind): string {
  return ACCOUNT_KINDS.find((x) => x.key === k)?.label ?? 'Customer';
}

/**
 * Client-safe: which key a merged-list row's type label is stored under — its Orcanos
 * tenant, else its name, lower-cased. The Usage screen's `account` is the same tenant string.
 * Storage: `lib/account-kind.ts` (server only).
 */
export function kindKeyOf(row: { tenant: string | null; account_name: string }): string {
  return (row.tenant || row.account_name).trim().toLowerCase();
}

/** Account-type filter — ONE setting shared by the Accounts and Usage screens. Per browser only. */
export type KindFilter = 'all' | AccountKind;
export const KIND_FILTER_KEY = 'accounts.kindFilter';
export function readKindFilter(): KindFilter {
  try {
    const v = localStorage.getItem(KIND_FILTER_KEY);
    return isAccountKind(v) ? v : 'all';
  } catch {
    return 'all';
  }
}
export function writeKindFilter(v: KindFilter) {
  try { localStorage.setItem(KIND_FILTER_KEY, v); } catch { /* storage blocked — not fatal */ }
}
