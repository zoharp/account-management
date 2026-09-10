/**
 * The shape of a region move as the operator sees it.
 *
 * Client-safe by construction — no `node:crypto`, no service key, nothing from
 * `lib/supabase` or `lib/trace`. `MoveRegionPanel` is a `'use client'` component
 * and imports this directly, which is the whole reason it is its own file rather
 * than an export from the route (see the import rules in CLAUDE.md).
 *
 * The list is ordered and fixed, and the panel renders all seven **before** the
 * move starts. That is deliberate: the operator is about to authorise something
 * whose last step is a delete, and seeing the plan is worth more than seeing a
 * bar. The server names the same keys as it passes them, so the checklist is
 * driven by what actually happened, never by a timer.
 *
 * Keep this in step with `api/accounts/move/route.ts` — a key emitted here that
 * the catalogue does not list simply never lights up, which looks like a hang.
 */

export const MOVE_STEPS = [
  { key: 'freeze', label: 'Freeze the source region' },
  { key: 'export', label: 'Export from the source' },
  { key: 'import', label: 'Import into the target' },
  { key: 'verify', label: 'Verify row counts' },
  { key: 'restore', label: 'Restore the access flag in the target' },
  { key: 'records', label: 'Update master and the region directory' },
  { key: 'purge', label: 'Purge the source copy' },
] as const;

export type MoveStepKey = (typeof MOVE_STEPS)[number]['key'];

/**
 * One NDJSON line. `done` and `failed` are terminal and carry what the old
 * single JSON body carried, because after the first flush the HTTP status is
 * always 200 and can no longer say anything.
 */
export type MoveEvent =
  | { t: 'step'; key: MoveStepKey; status: 'running' }
  | { t: 'step'; key: MoveStepKey; status: 'done'; note?: string }
  | { t: 'done'; steps: string[]; warning?: string; rows_moved?: number }
  | { t: 'failed'; key?: MoveStepKey; detail: string; steps: string[] };
