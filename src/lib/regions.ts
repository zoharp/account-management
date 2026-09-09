/**
 * Data residency — the one place the platform's region vocabulary is defined.
 *
 * A tenant's `accounts.region` is a single decision that three independent
 * stores must follow, and nothing joins them:
 *
 *   1. **The tenant's own Supabase project** (Ask Paul's vector DB) — created in
 *      `supabaseRegionFor(region)` by `lib/provisioning.ts`.
 *   2. **The traceability instance's SQLite** — a separate Fly app per region,
 *      each with its own volume and Litestream bucket. `traceApiUrlFor(region)`
 *      says which one owns this tenant's `account_access` row.
 *   3. **LLM calls** made for that tenant — an EU tenant must not reach a US
 *      endpoint, because requirement text and trainee names travel in the
 *      prompt.
 *
 * ⚠️ **Every one of the three fails silently when it is wrong.** A tenant
 * provisioned in the wrong region works perfectly; a tenant looked up in the
 * wrong traceability app simply appears not to exist; a US LLM call for an EU
 * tenant returns a normal answer. There is no error path that surfaces a
 * residency mistake, which is why the value is immutable (below) and why it is
 * validated at every boundary rather than trusted.
 *
 * ## Why region is immutable after provisioning
 *
 * Supabase cannot move a project between regions and a Fly volume is pinned to
 * one. So changing `accounts.region` moves no data — it only redirects every
 * reader to a region that does not hold the tenant. That is strictly worse than
 * the original mistake, because the console would then assert a residency
 * guarantee that does not hold. Moving a tenant is a
 * create → migrate → verify → delete, and that process writes the new value at
 * the end. An edit form must never offer it: `PATCH /api/accounts/:id` refuses.
 */

import type { DataRegion } from './types';

export const DATA_REGIONS: readonly DataRegion[] = ['us', 'eu'] as const;

export const DEFAULT_REGION: DataRegion = 'us';

/** What a person sees. The second line is the reason they are choosing it. */
export const REGION_LABELS: Record<DataRegion, { label: string; hint: string }> = {
  us: {
    label: 'United States',
    hint: 'Data at rest in us-east-1 (N. Virginia). The default for every account created before residency existed.',
  },
  eu: {
    label: 'European Union',
    hint: 'Data at rest in eu-central-1 (Frankfurt). Required for customers who contract for GDPR residency.',
  },
};

/**
 * Read a region off anything that came from outside — a form body, a PostgREST
 * row written before the migration, an env var. Unknown and absent both fall
 * back to `us`, which is where the data of every pre-migration tenant actually
 * is, so the fallback is a fact rather than a guess.
 *
 * Deliberately NOT used to validate user input — a typo must be refused, not
 * quietly turned into `us`. Use `parseRegion` for that.
 */
export function coerceRegion(value: unknown): DataRegion {
  return value === 'eu' ? 'eu' : DEFAULT_REGION;
}

/**
 * Validate a region supplied by a caller. Returns `null` for anything that is
 * not one of the two, so the route can answer 400 instead of provisioning a
 * tenant into a region nobody asked for.
 */
export function parseRegion(value: unknown): DataRegion | null {
  return typeof value === 'string' && (DATA_REGIONS as readonly string[]).includes(value)
    ? (value as DataRegion)
    : null;
}

/**
 * The Supabase Management API region slug for a project created in this region.
 *
 * `SUPABASE_PROJECT_REGION` still overrides the US slug, because that is the
 * variable every existing deployment sets and silently changing where US
 * projects are created would be a residency change of its own. It deliberately
 * cannot override the EU slug — an EU project must be in the EU whatever the
 * environment says.
 */
export function supabaseRegionFor(region: DataRegion): string {
  if (region === 'eu') return process.env.SUPABASE_PROJECT_REGION_EU || 'eu-central-1';
  return process.env.SUPABASE_PROJECT_REGION || 'us-east-1';
}

/**
 * The traceability instance that owns this region's tenants.
 *
 * `TRACE_API_URL` is the US app, kept under its original name so no existing
 * deployment breaks. `TRACE_API_URL_EU` is the Fly app in `fra`. When the EU app
 * is not configured yet this returns `null` rather than falling back to the US
 * one — a fallback here would write an EU tenant's row into the US database,
 * which is the exact thing this module exists to prevent.
 */
export function traceApiUrlFor(region: DataRegion): string | null {
  const url = region === 'eu' ? process.env.TRACE_API_URL_EU : process.env.TRACE_API_URL;
  return url?.replace(/\/$/, '') || null;
}
