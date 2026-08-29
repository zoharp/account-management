/**
 * The module catalog — which modules exist and what they are called.
 *
 * Deliberately dependency-free and in its own file, for the same reason
 * `orcanos-url.ts` is: the accounts table renders this list, and `lib/modules.ts`
 * reaches `lib/trace.ts`, which reads the traceability admin password. Nothing
 * on that path may be pulled into a client bundle.
 *
 * Adding a module is an entry here plus a source that can answer for it.
 */

import type { ModuleKey } from './types';

export interface ModuleDef {
  key: ModuleKey;
  label: string;
  /** Which system owns this module's licence — see `lib/modules.ts`. */
  source: 'master' | 'trace';
}

export const MODULES: readonly ModuleDef[] = [
  // Ask Paul IS the QMS AI app; `ask_paul_account` on the trace side is what a
  // tenant is called inside it (master `accounts.account_name`). Its licence is
  // `account_access.allow_ask_paul`, so all three modules now read from one
  // source and mean the same thing. Master `is_active` is the ACCOUNT gate and
  // belongs in the Status column, not here.
  { key: 'ask_paul', label: 'Ask Paul', source: 'trace' },
  { key: 'trace', label: 'Traceability', source: 'trace' },
  { key: 'training', label: 'Training', source: 'trace' },
];
