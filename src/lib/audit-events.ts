/**
 * The catalog of security events the platform writes, grouped the way an
 * auditor asks about them rather than the way the code emits them.
 *
 * Client-safe and dependency-free — the audit page renders it, so nothing here
 * may reach a secret. It is a *display and filter* catalog, not a whitelist of
 * what may be written: `logSecurityEvent` takes any string, and an event type
 * that is not listed here still lands in the table and still shows in the list.
 * It just doesn't get a group chip until someone adds it.
 *
 * Both apps append to one table, so this covers QMS's events too — a tenant's
 * history has to read continuously regardless of which app the admin used.
 */

export interface AuditEventGroup {
  key: string;
  label: string;
  /** What an auditor would be looking for when they pick this group. */
  hint: string;
  types: string[];
}

export const AUDIT_EVENT_GROUPS: readonly AuditEventGroup[] = [
  {
    key: 'signin',
    label: 'Sign-in',
    hint: 'Who got in, who was refused, and who was turned away by the staff gate.',
    types: ['login_succeeded', 'login_failed', 'login_denied', 'logout'],
  },
  {
    key: 'accounts',
    label: 'Accounts',
    hint: 'Tenant records created, changed or removed.',
    types: ['account_created', 'account_updated', 'account_deleted'],
  },
  {
    key: 'licences',
    label: 'Modules & licences',
    hint: 'Which modules an account may reach — Ask Paul, Traceability, Training.',
    types: [
      'account_module_changed',
      'trace_account_created',
      'trace_account_updated',
      'trace_account_deleted',
    ],
  },
  {
    key: 'secrets',
    label: 'Secrets & keys',
    hint: 'Every point at which a stored credential was set, rotated, revealed or used.',
    types: [
      'account_credentials_tested',
      'orcanos_login_tested',
      'trace_ai_config_changed',
      'trace_ai_key_tested',
      // Written by the QMS backend against the same table.
      'llm_key_set',
      'llm_key_revealed',
      'llm_key_deleted',
      'auth_methods_updated',
    ],
  },
  {
    key: 'provisioning',
    label: 'Provisioning',
    hint: 'Supabase projects created for a tenant — the ones that cost money.',
    types: ['account_provisioning_started', 'account_provisioning_failed'],
  },
  {
    key: 'users',
    label: 'Users & access',
    hint: 'Platform users and repository membership. Written by QMS.',
    types: ['user_deleted', 'repo_member_added', 'repo_member_updated', 'repo_member_removed'],
  },
];

/** Every catalogued type, flattened. */
export const ALL_AUDIT_TYPES: readonly string[] = AUDIT_EVENT_GROUPS.flatMap((g) => g.types);

/** The group an event type belongs to, or null if it predates the catalog. */
export function groupOf(eventType: string): AuditEventGroup | null {
  return AUDIT_EVENT_GROUPS.find((g) => g.types.includes(eventType)) ?? null;
}

/**
 * Event types are interpolated into a PostgREST filter, so they are validated
 * rather than trusted. The shape is deliberately narrow — every event this
 * platform writes is lower-case snake_case — which makes anything that could
 * break out of the `in.(…)` list impossible by construction.
 */
export const VALID_EVENT_TYPE = /^[a-z][a-z0-9_]{0,63}$/;
