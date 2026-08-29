/**
 * PUT /api/accounts/modules — license or unlicense ONE module for one account.
 *
 * Every module's licence lives where its runtime reads it (see `lib/modules.ts`):
 *
 *   trace     → trace `account_access.allow_trace`
 *   training  → trace `account_access.allow_training`
 *   ask_paul  → BOTH master `accounts.is_active` AND trace `allow_ask_paul`
 *
 * ## Why Ask Paul writes two systems
 *
 * They are two halves of one switch, and neither alone is "off":
 *
 *   is_active = 0        QMS AI's backend 403s every request — the app is dead
 *   allow_ask_paul = 0   only hides the hand-off button inside traceability;
 *                        the app still works if you go to it directly
 *
 * Before 2026-08-29 these were two separate controls in this console (a Status
 * pill and a module pill), which meant "deactivating" an account still left
 * Ask Paul reachable. One pill now writes both, so off means off. There is no
 * Status column any more — `is_active` is not a platform gate and never was
 * (INTERNAL_TRACE_MERGE.md §4.4); it is Ask Paul's half of this switch.
 *
 * **Partial writes are reported, never hidden.** The two systems have no shared
 * transaction, so if the second write fails the response says exactly which half
 * landed and answers non-2xx. The client reloads either way — the truth is what
 * the two sources now say, not what we asked for.
 *
 * Sits beside the dynamic `api/accounts/[id]` — Next resolves the static
 * segment first, which is what makes it reachable. Do not rename it to
 * something that looks like an id (CLAUDE.md, "Route precedence").
 */

import { requirePlatformStaff } from '@/lib/session';
import { pgPatch } from '@/lib/supabase';
import { logSecurityEvent } from '@/lib/audit';
import {
  listTraceAccounts,
  saveTraceAccount,
  supportsAskPaul,
  supportsModules,
  traceConfigured,
  TraceApiError,
} from '@/lib/trace';
import type { ModuleKey } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MODULE_KEYS: ModuleKey[] = ['ask_paul', 'trace', 'training'];

/** The `account_access` column each module is licensed by. */
const MODULE_COLUMN: Record<ModuleKey, 'allow_ask_paul' | 'allow_trace' | 'allow_training'> = {
  ask_paul: 'allow_ask_paul',
  trace: 'allow_trace',
  training: 'allow_training',
};

export async function PUT(req: Request) {
  const { user, error } = await requirePlatformStaff();
  if (error) return error;

  const body = (await req.json().catch(() => ({}))) as {
    module?: string;
    enabled?: boolean;
    account_id?: string | null;
    tenant?: string | null;
  };

  const module = body.module as ModuleKey;
  if (!MODULE_KEYS.includes(module)) {
    return Response.json({ detail: `Unknown module '${body.module}'` }, { status: 400 });
  }
  const enabled = Boolean(body.enabled);

  const tenant = (body.tenant ?? '').trim().toLowerCase();

  // ── Ask Paul: the master half first, because it is the real kill switch.
  // A tenant with only one of the two halves present is the NORMAL case here —
  // 12 of the 15 accounts are trace-only — so a missing half is skipped, not an
  // error. Only a write that was attempted and failed is an error.
  if (module === 'ask_paul') {
    const wrote: string[] = [];

    if (body.account_id) {
      await pgPatch(`accounts?id=eq.${encodeURIComponent(body.account_id)}`, {
        is_active: enabled,
      });
      wrote.push('the QMS AI account');
    }

    if (tenant && traceConfigured()) {
      try {
        const rows = await listTraceAccounts();
        const current = rows.find((r) => r.account.toLowerCase() === tenant);
        if (!supportsAskPaul(rows)) {
          throw new TraceApiError(
            'this traceability instance predates the Ask Paul licence (needs 3.27.0) and ' +
              'would have silently discarded the flag',
            409,
          );
        }
        if (!current) throw new TraceApiError(`'${tenant}' is not in the allowlist`, 404);
        await saveTraceAccount(current, { allow_ask_paul: enabled ? 1 : 0 });
        wrote.push('the traceability hand-off');
      } catch (e) {
        const half = e instanceof Error ? e.message : String(e);
        await logSecurityEvent('account_module_changed', {
          user,
          accountName: tenant,
          success: false,
          detail: { module, enabled, tenant, wrote, error: half },
        });
        // Say exactly which half landed. Reporting a clean failure here while
        // master is already flipped is the one outcome that would mislead.
        return Response.json(
          {
            detail: wrote.length
              ? `${enabled ? 'Licensed' : 'Unlicensed'} ${wrote.join(' and ')}, but the ` +
                `traceability hand-off was NOT changed: ${half}. The two are now out of step.`
              : `Traceability was not updated: ${half}`,
            partial: wrote,
          },
          { status: e instanceof TraceApiError && e.status !== 401 ? e.status : 502 },
        );
      }
    }

    if (!wrote.length) {
      return Response.json(
        {
          detail:
            'This account has neither a master record nor a traceability allowlist entry, ' +
            'so there is nothing to license.',
        },
        { status: 409 },
      );
    }

    await logSecurityEvent('account_module_changed', {
      user,
      accountName: tenant || undefined,
      detail: { module, enabled, tenant, account_id: body.account_id, wrote },
    });
    return Response.json({ ok: true, module, enabled, wrote });
  }

  // ── traceability-owned modules
  if (!tenant) {
    return Response.json(
      {
        detail:
          'This account has no Orcanos tenant, so its traceability licence cannot be located. ' +
          'Set the account’s Orcanos API URL first.',
      },
      { status: 409 },
    );
  }
  if (!traceConfigured()) {
    return Response.json(
      { detail: 'Traceability is not connected (TRACE_API_URL / TRACE_ADMIN_PASSWORD).' },
      { status: 503 },
    );
  }

  try {
    const rows = await listTraceAccounts();

    // Refuse rather than write blind. The trace API has no PATCH — a save
    // rewrites the whole row — so writing to an instance that has no module
    // columns would succeed, drop the flag on the floor, and report success.
    // That silent-discard shape is exactly what this repo's audit path got
    // wrong once already; do not repeat it.
    // (Ask Paul returned above and runs the equivalent `supportsAskPaul` check
    // there — its column landed in 3.27.0, four releases later than these two.)
    if (!supportsModules(rows)) {
      return Response.json(
        {
          detail:
            'This traceability instance predates per-module licences and would silently ' +
            'discard the change. Deploy traceability-matrix 3.23.0 first.',
        },
        { status: 409 },
      );
    }

    const current = rows.find((r) => r.account.toLowerCase() === tenant);
    if (!current) {
      return Response.json(
        { detail: `Tenant '${tenant}' is not in the traceability allowlist.` },
        { status: 404 },
      );
    }

    // One flag changes; every other column travels back exactly as it arrived.
    // `saveTraceAccount` does the merge, so a column added on the trace side
    // (as `ask_paul_account` was in 3.27.0) is preserved without a change here.
    const changes = { [MODULE_COLUMN[module]]: enabled ? 1 : 0 };
    const next = { ...current, ...changes };

    // Same invariant the trace admin page enforces in the browser and its API
    // does not enforce at all: an account with no module can sign in and reach
    // nothing. Turning the last one off is two clicks from here, so it is
    // checked on this path too, not only in the settings dialog.
    // An absent column reads as licensed, matching `_modules_of`. Ask Paul is
    // not part of this: it is a separate app, so holding it alone is still not
    // a module anyone can sign in to.
    if (!(next.allow_trace ?? 1) && !(next.allow_training ?? 1)) {
      return Response.json(
        {
          detail:
            `'${tenant}' would be left with no module and could sign in to nothing. ` +
            'License Traceability or Training first.',
        },
        { status: 400 },
      );
    }

    await saveTraceAccount(current, changes);

    await logSecurityEvent('account_module_changed', {
      user,
      accountName: tenant,
      detail: { module, enabled, tenant, source: 'traceability' },
    });
    return Response.json({ ok: true, module, enabled });
  } catch (e) {
    const status = e instanceof TraceApiError ? e.status : 500;
    return Response.json(
      { detail: e instanceof Error ? e.message : String(e) },
      { status: status === 401 ? 502 : status },
    );
  }
}
