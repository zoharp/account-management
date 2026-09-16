/**
 * Which internal systems the ISO 27001 screen can show — one entry per repo
 * the `compliance-audit` Claude skill has been (or will be) run against.
 *
 * A control's `system_name` in `iso27001_controls` must be one of these keys.
 * Adding a new audited system is one line here plus a `compliance/scope.yaml`
 * in that repo — see `~/.claude/skills/compliance-audit/SKILL.md`.
 */

import type { Iso27001System } from './types';

export const ISO27001_SYSTEMS: readonly Iso27001System[] = [
  { key: 'orcanos-qms', label: 'Orcanos QMS' },
];

export const DEFAULT_ISO27001_SYSTEM = ISO27001_SYSTEMS[0].key;
