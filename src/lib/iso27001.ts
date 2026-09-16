/**
 * ISO 27001 helpers shared by the `api/iso27001/*` routes: control ordering,
 * the "which run is current" lookup, and validating an uploaded
 * `compliance-audit` ledger before anything is written.
 */

import { pgGet } from './supabase';
import type { Iso27001AuditRun, Iso27001Status, Iso27001Theme } from './types';

export const ISO27001_STATUSES: readonly Iso27001Status[] = ['pass', 'partial', 'fail', 'blocked', 'not_applicable'];
export const ISO27001_THEMES: readonly Iso27001Theme[] = ['Organizational', 'People', 'Physical', 'Technological'];

/**
 * `control_id` sorts lexically in PostgREST ('A.5.10' before 'A.5.2'), so sort
 * here the same way the compliance-audit skill's report generator does —
 * split on '.', compare numerically.
 */
export function sortByControlId<T extends { control_id: string }>(rows: T[]): T[] {
  return rows.sort((a, b) => {
    const pa = a.control_id.slice(2).split('.').map(Number);
    const pb = b.control_id.slice(2).split('.').map(Number);
    return pa[0] - pb[0] || (pa[1] ?? 0) - (pb[1] ?? 0);
  });
}

/** Newest run for a system, or null if none was ever imported. */
export async function latestRun(system: string): Promise<Iso27001AuditRun | null> {
  const rows = await pgGet<Iso27001AuditRun[]>(
    `iso27001_audit_runs?select=*&system_name=eq.${encodeURIComponent(system)}` +
      `&order=run_date.desc,created_at.desc&limit=1`,
  );
  return rows[0] ?? null;
}

export interface ParsedLedgerControl {
  control_id: string;
  title: string;
  theme: Iso27001Theme;
  status: Iso27001Status;
  check_ids: string[];
  evidence: string | null;
}

export interface ParsedLedger {
  run_date: string;
  controls: ParsedLedgerControl[];
}

const CONTROL_ID = /^A\.[5-8]\.\d{1,2}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CONTROLS = 200;
const MAX_EVIDENCE = 20_000;

/**
 * Validate a `compliance/…/ledger.json` as the skill writes it:
 * `{ framework, last_run, controls: { "A.5.1": { title, theme, status, check_ids, evidence?, … } } }`.
 * Returns the controls or a message naming the first thing wrong — all or
 * nothing, so a half-valid file never becomes a half-imported run.
 */
export function parseLedger(raw: unknown): { ledger: ParsedLedger } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Ledger must be a JSON object' };
  const l = raw as Record<string, unknown>;

  if (l.framework !== 'iso27001-2022') {
    return { error: `Unsupported framework ${JSON.stringify(l.framework)} — expected "iso27001-2022"` };
  }
  if (typeof l.last_run !== 'string' || !ISO_DATE.test(l.last_run) || Number.isNaN(Date.parse(l.last_run))) {
    return { error: 'Ledger "last_run" must be a YYYY-MM-DD date' };
  }
  if (!l.controls || typeof l.controls !== 'object' || Array.isArray(l.controls)) {
    return { error: 'Ledger "controls" must be an object keyed by control id' };
  }

  const entries = Object.entries(l.controls as Record<string, unknown>);
  if (entries.length === 0) return { error: 'Ledger has no controls' };
  if (entries.length > MAX_CONTROLS) return { error: `Ledger has ${entries.length} controls — more than Annex A` };

  const controls: ParsedLedgerControl[] = [];
  for (const [id, value] of entries) {
    if (!CONTROL_ID.test(id)) return { error: `"${id}" is not an Annex A control id` };
    const c = (value ?? {}) as Record<string, unknown>;
    if (typeof c.title !== 'string' || !c.title.trim()) return { error: `${id}: missing title` };
    if (!ISO27001_THEMES.includes(c.theme as Iso27001Theme)) return { error: `${id}: invalid theme` };
    if (!ISO27001_STATUSES.includes(c.status as Iso27001Status)) return { error: `${id}: invalid status` };
    const checkIds = Array.isArray(c.check_ids) ? c.check_ids : [];
    if (!checkIds.every((x) => typeof x === 'string')) return { error: `${id}: check_ids must be strings` };
    if (c.evidence != null && typeof c.evidence !== 'string') return { error: `${id}: evidence must be text` };

    controls.push({
      control_id: id,
      title: c.title.trim(),
      theme: c.theme as Iso27001Theme,
      status: c.status as Iso27001Status,
      check_ids: checkIds as string[],
      evidence: typeof c.evidence === 'string' && c.evidence.trim() ? c.evidence.slice(0, MAX_EVIDENCE) : null,
    });
  }

  return { ledger: { run_date: l.last_run, controls: sortByControlId(controls) } };
}

/** `{pass: n, partial: n, …}` for a run's summary column. */
export function summarize(controls: { status: Iso27001Status }[]): Partial<Record<Iso27001Status, number>> {
  const out: Partial<Record<Iso27001Status, number>> = {};
  for (const c of controls) out[c.status] = (out[c.status] ?? 0) + 1;
  return out;
}
