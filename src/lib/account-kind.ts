/**
 * Customer vs Demo — a staff label on every account, used to filter the Accounts and Usage
 * screens so demo/test tenants don't distort the numbers. Nothing else reads it: it gates no
 * licence, no sign-in and no billing.
 *
 * Stored in master `platform_settings` (sql/008, already applied) as ONE ROW PER TENANT:
 *   key   = `account_kind:<tenant lower-cased>`
 *   value = {"kind": "demo" | "customer"}
 * One row per tenant (not one JSON map) so two people classifying different accounts at the
 * same time cannot overwrite each other's change.
 *
 * Keyed on the TENANT, not the master uuid: 12 of 15 accounts are traceability-only and have no
 * master row, and the Usage screen (traceability `usage_daily`) only knows the tenant. A master
 * account's tenant comes from `tenantOf` (lib/modules.ts) — the same rule the merged list uses.
 *
 * **No row = Customer.** That is the default for every existing and every new account.
 */

import { pgGet, pgUpsert } from './supabase';
import type { AccountKind } from './types';

const PREFIX = 'account_kind:';

export function normaliseKindKey(tenant: string): string {
  return tenant.trim().toLowerCase();
}

export function parseKind(v: unknown): AccountKind | null {
  return v === 'demo' || v === 'customer' ? v : null;
}

/** Every stored classification, by lower-cased tenant. A read failure yields an empty map (= all Customer). */
export async function listAccountKinds(): Promise<Record<string, AccountKind>> {
  try {
    const rows = await pgGet<Array<{ key: string; value?: { kind?: unknown } }>>(
      `platform_settings?key=like.${encodeURIComponent(PREFIX)}*&select=key,value`,
    );
    const out: Record<string, AccountKind> = {};
    for (const r of rows) {
      const kind = parseKind(r.value?.kind);
      if (kind) out[r.key.slice(PREFIX.length)] = kind;
    }
    return out;
  } catch (e) {
    console.error('[account-kind] read failed — every account reads as Customer:', e);
    return {};
  }
}

export async function setAccountKind(tenant: string, kind: AccountKind, by: string): Promise<void> {
  await pgUpsert('platform_settings', 'key', {
    key: PREFIX + normaliseKindKey(tenant),
    value: { kind },
    updated_at: new Date().toISOString(),
    updated_by: by,
  });
}
