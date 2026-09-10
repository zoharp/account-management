/**
 * POST /api/accounts/move — move ONE tenant's data to another data region.
 *
 * ## Why this is a route and not a checkbox
 *
 * `accounts.region` is refused by `PATCH /api/accounts/:id` on purpose: flipping
 * it moves nothing, it only records the customer as living somewhere they do not.
 * A real move is a physical migration between two SQLite files that share no
 * connection — so this route is the *only* sanctioned way the field changes, and
 * it changes it at the end, after the data has actually arrived.
 *
 * ## The order, and why each step is where it is
 *
 *   1. **Freeze the source** (`allow_access = 0`). Everything after this reads
 *      the source; a panel saved mid-export would be exported or not depending
 *      on timing and then destroyed by the purge. Freezing signs the customer
 *      out of the region they are leaving, which is the honest thing to do — the
 *      alternative is a window where their writes are being silently discarded.
 *   2. **Export**, then **import**, then **compare row counts**. The import is
 *      one transaction on the target, so it either all landed or none did.
 *   3. **Verify.** If a table arrived short, or the target's schema had no home
 *      for one, the move STOPS here with the source still intact. This is the
 *      whole reason the purge is last.
 *   4. **Unfreeze on the target** — restoring the access flag the tenant had
 *      before step 1, not a default. A customer who was suspended stays
 *      suspended.
 *   5. **Master**, then the **directory in every region**. Now that the data is
 *      really there, the records that point at it are updated.
 *   6. **Purge the source.** Until this runs the customer's data exists in two
 *      regions — which is the violation the whole exercise is meant to end. A
 *      failure here is reported loudly and needs a human, because "copied" is a
 *      worse state than either endpoint.
 *
 * ## What this route does NOT move
 *
 * The tenant's own Supabase project (Ask Paul's vector database). Supabase
 * cannot relocate a project, so an Ask Paul customer additionally needs a fresh
 * project provisioned in the new region and a full re-index. The response says
 * so rather than leaving it to be discovered.
 */

import { requirePlatformStaff } from '@/lib/session';
import { pgGet, pgPatch } from '@/lib/supabase';
import { logSecurityEvent } from '@/lib/audit';
import { parseRegion, traceApiUrlFor } from '@/lib/regions';
import {
  exportTenant,
  importTenant,
  listTraceAccounts,
  purgeTenant,
  saveTraceAccount,
  upsertRegionDirectory,
  type TraceAccountRow,
} from '@/lib/trace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** A big tenant's snapshots take a while to ship; this is not a quick call. */
export const maxDuration = 300;

export async function POST(req: Request) {
  const { user, error } = await requirePlatformStaff();
  if (error) return error;

  const body = (await req.json().catch(() => ({}))) as {
    tenant?: string;
    to_region?: string;
    account_id?: string | null;
  };

  const tenant = (body.tenant ?? '').trim().toLowerCase();
  if (!tenant) return bad('Missing: tenant');

  const to = parseRegion(body.to_region);
  if (!to) return bad(`Unknown region '${String(body.to_region)}'. Expected 'us' or 'eu'.`);
  if (!traceApiUrlFor(to)) {
    return bad(`The ${to.toUpperCase()} region is not configured on this console.`);
  }

  // Where it is now, taken from the instances themselves rather than from master.
  // Master records an intention; the instance holding the rows is the fact, and a
  // move must act on the fact.
  let rows: TraceAccountRow[];
  try {
    rows = await listTraceAccounts();
  } catch (e) {
    return bad(
      `Could not read the traceability instances, so the move cannot start: ${msg(e)}`,
      502,
    );
  }

  const matches = rows.filter((r) => (r.account ?? '').trim().toLowerCase() === tenant);
  if (matches.length === 0) {
    return bad(`No traceability instance holds tenant '${tenant}'.`, 404);
  }
  if (matches.length > 1) {
    // The tenant exists in BOTH regions. Almost certainly a previous move whose
    // purge failed. Refusing is right: this route cannot tell which copy is
    // current, and picking one would destroy the other.
    return bad(
      `Tenant '${tenant}' exists in more than one region (${matches
        .map((m) => m.region)
        .join(', ')}). That is a half-finished move: resolve which copy is current ` +
        `before moving it again.`,
      409,
    );
  }

  const current = matches[0];
  const from = current.region;
  if (!from) return bad(`Could not determine which region holds '${tenant}'.`, 500);
  if (from === to) return bad(`'${tenant}' is already in the ${to.toUpperCase()} region.`);

  const steps: string[] = [];
  const startedAt = Date.now();

  try {
    // 1 ── Freeze the source.
    await saveTraceAccount(current, { allow_access: 0 });
    steps.push(`froze '${tenant}' in ${from.toUpperCase()}`);

    // 2 ── Export → import.
    const exported = await exportTenant(tenant, from);
    steps.push(`exported ${exported.total_rows} rows from ${from.toUpperCase()}`);

    const imported = await importTenant(exported, to);
    steps.push(`imported ${imported.total_rows} rows into ${to.toUpperCase()}`);

    // 3 ── Verify BEFORE anything destructive.
    const shortfall = Object.entries(exported.counts).filter(
      ([table, n]) => (imported.counts[table] ?? 0) !== n,
    );
    const skipped = Object.keys(imported.skipped_tables ?? {});
    if (shortfall.length || skipped.length) {
      // Deliberately leaves the source frozen. A half-moved tenant must not be
      // quietly reopened for writing in the region it is leaving.
      await logSecurityEvent('account_region_move', {
        user,
        accountName: tenant,
        success: false,
        detail: { from, to, shortfall, skipped, steps },
      });
      return Response.json(
        {
          detail:
            `The move was STOPPED before anything was deleted: the target did not receive ` +
            `everything. ${
              shortfall.length
                ? `Short tables: ${shortfall.map(([t, n]) => `${t} (${n} sent, ${imported.counts[t] ?? 0} landed)`).join('; ')}. `
                : ''
            }${
              skipped.length
                ? `Tables the ${to.toUpperCase()} instance has no home for: ${skipped.join(', ')} — it is probably on an older release. `
                : ''
            }The source still holds everything and '${tenant}' is left signed out there. ` +
            `Fix the target, then run the move again.`,
          steps,
        },
        { status: 409 },
      );
    }
    steps.push('verified row counts match');

    // 4 ── Restore the access flag the tenant actually had, on the target.
    const landed = (await listTraceAccounts()).find(
      (r) => (r.account ?? '').trim().toLowerCase() === tenant && r.region === to,
    );
    if (landed) {
      await saveTraceAccount(landed, { allow_access: current.allow_access });
      steps.push(`restored access in ${to.toUpperCase()}`);
    }

    // 5 ── The records that point at the data, now that the data is there.
    if (body.account_id) {
      await pgPatch(`accounts?id=eq.${encodeURIComponent(body.account_id)}`, { region: to });
      steps.push('updated the master account record');
    }
    const { failed } = await upsertRegionDirectory(tenant, to);
    steps.push(
      failed.length
        ? `directory updated, except: ${failed.join(', ')}`
        : 'directory updated in every region',
    );

    // 6 ── Only now is the source redundant.
    const purged = await purgeTenant(tenant, from);
    steps.push(`purged ${purged.total_rows} rows from ${from.toUpperCase()}`);

    // Ask Paul's per-tenant Supabase project cannot be relocated, so say so
    // rather than letting it be discovered later.
    let askPaulNote = '';
    if (body.account_id) {
      const acct = await pgGet<Array<{ vector_db_host?: string | null }>>(
        `accounts?id=eq.${encodeURIComponent(body.account_id)}&select=vector_db_host`,
      );
      if ((acct[0]?.vector_db_host ?? '').trim()) {
        askPaulNote =
          ` This account also has an Ask Paul vector database, which is a Supabase project and ` +
          `CANNOT be moved between regions. Its data is still in ${from.toUpperCase()}: provision a ` +
          `new project in ${to.toUpperCase()} and re-index before the move is complete for GDPR.`;
      }
    }

    await logSecurityEvent('account_region_move', {
      user,
      accountName: tenant,
      detail: {
        from,
        to,
        rows: exported.total_rows,
        tables: exported.counts,
        directory_failed: failed,
        seconds: Math.round((Date.now() - startedAt) / 1000),
      },
    });

    return Response.json({
      ok: true,
      tenant,
      from,
      to,
      rows_moved: exported.total_rows,
      steps,
      warning: askPaulNote || undefined,
    });
  } catch (e) {
    // Whatever failed, the source has NOT been purged unless the last step ran —
    // and if it did, the failure is after the point of no return and says so.
    await logSecurityEvent('account_region_move', {
      user,
      accountName: tenant,
      success: false,
      detail: { from, to, steps, error: msg(e) },
    });
    return Response.json(
      {
        detail:
          `The move failed: ${msg(e)}. Completed steps: ${steps.join(' → ') || 'none'}. ` +
          `'${tenant}' is left signed out of ${from.toUpperCase()}; nothing was deleted unless ` +
          `"purged" appears in those steps.`,
        steps,
      },
      { status: 500 },
    );
  }
}

function bad(detail: string, status = 400) {
  return Response.json({ detail }, { status });
}

function msg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
