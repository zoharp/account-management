/**
 * Priority and "what to do about it" for ISO 27001 controls, derived from the
 * `compliance-audit` skill's checks (`.claude/skills/compliance-audit/checks/registry.yaml`).
 *
 * Nothing here is stored: it is computed from a control's `check_ids` and its
 * evidence text, so it applies to saved runs as well as the current view and
 * needs no migration. To change a rating or a fix, edit `CHECKS` below.
 *
 * The rule:
 *  - A **procedure** gap (an `org.*` attestation — a policy, an inventory entry,
 *    a signed DPA) is always **low**: paperwork, not an exposure.
 *  - A **security** gap (code, database, hosting, pentest) takes the check's
 *    severity when it failed, one level lower when it is partial or blocked.
 *  - A control's priority is the highest of its open checks; compliant and
 *    N/A controls have none.
 */

import type { Iso27001Status } from './types';

export type Iso27001Priority = 'low' | 'medium' | 'high' | 'critical';
export type Iso27001GapKind = 'procedure' | 'security';

export const PRIORITY_ORDER: readonly Iso27001Priority[] = ['low', 'medium', 'high', 'critical'];

export const PRIORITY_LABEL: Record<Iso27001Priority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

/** `acl-toggle` modifier for each priority's pill. */
export const PRIORITY_TOGGLE: Record<Iso27001Priority, string> = {
  low: 'acl-toggle--off',
  medium: 'acl-toggle--warn',
  high: 'acl-toggle--err',
  critical: 'acl-toggle--crit',
};

interface CheckGuidance {
  label: string;
  kind: Iso27001GapKind;
  /** Severity when the check fails outright. Procedure checks are always low. */
  severity: Iso27001Priority;
  /** One line, for the table. */
  action: string;
  /** The concrete steps, for the dialog. */
  steps: string[];
}

const CHECKS: Record<string, CheckGuidance> = {
  // ── code ─────────────────────────────────────────────────────────────
  'code.secret_scanning': {
    label: 'Secrets in git',
    kind: 'security',
    severity: 'critical',
    action: 'Rotate every exposed credential, then purge it from history',
    steps: [
      'Rotate (revoke and reissue) every credential that was ever committed — removing it from the repo does not make it safe.',
      'Purge the files from history with git filter-repo, then force-push and ask everyone to re-clone.',
      'Add gitleaks (or GitHub secret scanning with push protection) to CI and as a pre-commit hook.',
      'Make sure .gitignore covers .env*, *.pem and *.key.',
    ],
  },
  'code.dependency_vuln_scan': {
    label: 'Vulnerable dependencies',
    kind: 'security',
    severity: 'high',
    action: 'Upgrade the flagged packages and lock every dependency',
    steps: [
      'Run npm audit fix (or upgrade the flagged packages by hand) and redeploy.',
      'Lock Python dependencies: pin exact versions with pip-compile or uv lock instead of floating >= bounds.',
      'Turn on Dependabot or Renovate for the repo.',
      'Fail the CI build on high/critical advisories (npm audit --audit-level=high, pip-audit).',
    ],
  },
  'code.static_authz_review': {
    label: 'Authorization / tenant isolation',
    kind: 'security',
    severity: 'high',
    action: 'Enforce tenant scoping structurally, not per endpoint',
    steps: [
      'Move the membership check into one shared dependency/middleware that every data route must use.',
      'Add Row Level Security (or an equivalent DB-level filter) as a backstop behind the API.',
      'Add tests that call each route as a user of another tenant and expect 403/404.',
      'Escape every id interpolated into a PostgREST filter.',
    ],
  },
  'code.authentication_review': {
    label: 'Authentication',
    kind: 'security',
    severity: 'high',
    action: 'Remove fallback secrets, enforce MFA for admins, rate-limit login',
    steps: [
      'Delete any hardcoded fallback JWT/session secret — refuse to start when the real one is missing.',
      'Require MFA for admin and privileged roles.',
      'Rate-limit and lock out repeated failures on login and password-reset endpoints.',
      'Confirm password hashing uses bcrypt/argon2 and sessions expire.',
    ],
  },
  'code.crypto_review': {
    label: 'Encryption',
    kind: 'security',
    severity: 'high',
    action: 'Encrypt secrets at rest with a managed key; enforce TLS',
    steps: [
      'Encrypt stored secrets with AES-GCM using a key from the secret manager, not an encoding or a hardcoded key.',
      'Enforce HTTPS everywhere and send HSTS.',
      'Require SSL on every database connection.',
    ],
  },
  'code.audit_logging_review': {
    label: 'Audit logging',
    kind: 'security',
    severity: 'medium',
    action: 'Make security events land in a queryable, retained log',
    steps: [
      'Confirm the audit-log table/migration is applied in production and events are actually arriving.',
      'Log every failed login and every admin or permission change.',
      'Alert when an audit write fails instead of falling back to stdout silently.',
      'Set a retention period and restrict who can read or delete the log.',
    ],
  },
  'code.secure_sdlc_review': {
    label: 'Secure development pipeline',
    kind: 'security',
    severity: 'medium',
    action: 'Add CI that tests, audits and secret-scans before every deploy',
    steps: [
      'Add a CI pipeline (GitHub Actions or a Cloud Build test step) that runs tests and the build on every push.',
      'Add a dependency audit and a secret scan as blocking steps.',
      'Enable branch protection on main: required review and required status checks.',
    ],
  },
  'code.source_code_access_review': {
    label: 'Repository access',
    kind: 'security',
    severity: 'medium',
    action: 'Review who can read/write the repo; enforce 2FA',
    steps: [
      'List the repo collaborators and teams; remove anyone who no longer needs access.',
      'Enforce 2FA on the GitHub organization.',
      'Record the review (date, who, what changed) as evidence and repeat it quarterly.',
    ],
  },
  'code.env_separation_review': {
    label: 'Environment separation',
    kind: 'security',
    severity: 'high',
    action: 'Give dev/test their own credentials and data',
    steps: [
      'Use separate databases and API keys for dev, test and production.',
      'Remove any production secret from test configs and local .env files.',
      'Never copy production customer data into test without masking it.',
    ],
  },
  'code.data_deletion_review': {
    label: 'Data deletion',
    kind: 'security',
    severity: 'medium',
    action: 'Make deletion purge everything the user owns, or say what it leaves',
    steps: [
      'Cascade user/account deletion to every table that holds their data.',
      'Where a purge is deliberately partial, return and log exactly what was kept.',
      'Document the retention and deletion rules per data type.',
    ],
  },
  'code.data_masking_review': {
    label: 'Error / log leakage',
    kind: 'security',
    severity: 'medium',
    action: 'Stop returning raw exception text; log it server-side',
    steps: [
      'Replace str(e) in HTTP responses with a generic message plus a correlation id.',
      'Log the full exception server-side against that id.',
      'Scrub tokens, passwords and PII from log statements.',
    ],
  },
  'code.change_management_review': {
    label: 'Change management',
    kind: 'security',
    severity: 'medium',
    action: 'Deploy only through a defined pipeline',
    steps: [
      'Make the CI/CD pipeline the only path to production; remove manual deploy rights where possible.',
      'Keep a release record (version, notes, who approved) for each deploy.',
    ],
  },

  // ── supabase ─────────────────────────────────────────────────────────
  'supabase.rls_policies': {
    label: 'Row Level Security',
    kind: 'security',
    severity: 'high',
    action: 'Enable RLS on every table reachable by the anon key',
    steps: [
      'Enable RLS on every table in the exposed schema; with no policy, the anon key reads nothing.',
      'Add explicit policies only where the browser genuinely needs direct access.',
      'If the frontend never queries Supabase directly, stop shipping the anon key to it.',
    ],
  },
  'supabase.auth_config': {
    label: 'Auth configuration',
    kind: 'security',
    severity: 'high',
    action: 'Harden password policy, enforce MFA, set session timeouts',
    steps: [
      'Raise the minimum password length to 12+ and enable the leaked-password (HaveIBeenPwned) check.',
      'Enforce MFA (TOTP) for admin and privileged users.',
      'Set a session inactivity timeout and a maximum session lifetime.',
      'Enable CAPTCHA on sign-up and sign-in, or disable public sign-up.',
    ],
  },
  'supabase.api_key_management': {
    label: 'API keys',
    kind: 'security',
    severity: 'critical',
    action: 'Keep the service-role key server-side only; rotate if exposed',
    steps: [
      'Confirm the service-role key appears in no frontend bundle or public env var.',
      'Rotate the key if it was ever exposed, and update every server that uses it.',
      'Document where each key is used and how to rotate it.',
    ],
  },
  'supabase.network_restrictions': {
    label: 'Database network access',
    kind: 'security',
    severity: 'high',
    action: 'Restrict direct Postgres access to known IPs; enforce SSL',
    steps: [
      'In Supabase → Database → Network restrictions, replace 0.0.0.0/0 and ::/0 with the backend egress IPs.',
      'Enable SSL enforcement on the database.',
      'Rotate the database password if it has been widely shared.',
    ],
  },
  'supabase.backup_pitr': {
    label: 'Backups / point-in-time recovery',
    kind: 'security',
    severity: 'medium',
    action: 'Enable PITR and prove a restore works',
    steps: [
      'Enable Point-In-Time Recovery (a paid add-on) so data loss is minutes, not up to a day.',
      'Restore a backup into a scratch project and record the result as evidence.',
      'Set retention to match how critical the data is.',
    ],
  },
  'supabase.audit_logging': {
    label: 'Database audit logs',
    kind: 'security',
    severity: 'medium',
    action: 'Review and retain auth and Postgres logs',
    steps: [
      'Confirm auth and Postgres logs are retained long enough (export them to a log sink if not).',
      'Restrict who can read the logs.',
    ],
  },
  'supabase.role_privilege_review': {
    label: 'Database roles',
    kind: 'security',
    severity: 'medium',
    action: 'Apply least privilege to database roles and grants',
    steps: [
      'Revoke grants the anon/authenticated roles do not need.',
      'Keep the service role confined to the backend; use narrower roles for reporting or tooling.',
    ],
  },

  // ── hosting ──────────────────────────────────────────────────────────
  'fly.secrets_management': {
    label: 'Fly.io secrets',
    kind: 'security',
    severity: 'high',
    action: 'Move every secret into fly secrets',
    steps: [
      'Set secrets with fly secrets set; remove any from fly.toml, Dockerfiles or images.',
      'Provide a Fly.io API token so the audit can verify this automatically.',
    ],
  },
  'fly.network_firewall': {
    label: 'Fly.io network',
    kind: 'security',
    severity: 'high',
    action: 'Keep internal services private; terminate TLS',
    steps: [
      'Expose only the public app; keep internal services on the private network.',
      'Confirm TLS terminates on every public service.',
      'Provide a Fly.io API token so the audit can verify this automatically.',
    ],
  },
  'fly.machine_image_currency': {
    label: 'Fly.io images',
    kind: 'security',
    severity: 'medium',
    action: 'Rebuild on current base images regularly',
    steps: [
      'Rebuild and redeploy on a current base image at least monthly.',
      'Provide a Fly.io API token so the audit can verify this automatically.',
    ],
  },
  'vercel.env_var_scoping': {
    label: 'Vercel env vars',
    kind: 'security',
    severity: 'high',
    action: 'Scope env vars per environment; no secrets in NEXT_PUBLIC_*',
    steps: [
      'Scope production secrets to Production only, not Preview.',
      'Make sure no server-only secret is prefixed NEXT_PUBLIC_.',
      'Provide a Vercel API token so the audit can verify this automatically.',
    ],
  },
  'vercel.deployment_protection': {
    label: 'Vercel deployment protection',
    kind: 'security',
    severity: 'medium',
    action: 'Protect preview deployments; enforce team 2FA',
    steps: [
      'Turn on Vercel Authentication (or password protection) for preview deployments.',
      'Enforce 2FA for the Vercel team.',
      'Provide a Vercel API token so the audit can verify this automatically.',
    ],
  },
  'vercel.domain_tls': {
    label: 'Vercel domains / TLS',
    kind: 'security',
    severity: 'medium',
    action: 'Enforce HTTPS and HSTS on every domain',
    steps: [
      'Redirect all HTTP to HTTPS and send an HSTS header.',
      'Provide a Vercel API token so the audit can verify this automatically.',
    ],
  },

  // ── pentest ──────────────────────────────────────────────────────────
  'pentest.auth_flow_abuse': {
    label: 'Auth flow abuse',
    kind: 'security',
    severity: 'high',
    action: 'Rate-limit auth flows; verify OAuth state and session rotation',
    steps: [
      'Rate-limit and lock out login, password reset and OTP endpoints.',
      'Validate the OAuth state parameter on every callback.',
      'Issue a new session id at login to prevent session fixation.',
    ],
  },
  'pentest.idor_review': {
    label: 'Cross-tenant access (IDOR)',
    kind: 'security',
    severity: 'critical',
    action: 'Check ownership on every object reference',
    steps: [
      'On every route taking an id, verify the object belongs to the caller’s tenant before returning or changing it.',
      'Add cross-tenant tests for each such route.',
    ],
  },
  'pentest.ssrf_review': {
    label: 'Server-side request forgery',
    kind: 'security',
    severity: 'critical',
    action: 'Block private, loopback and metadata targets on outbound fetches',
    steps: [
      'Resolve the host and reject private, loopback, link-local and cloud-metadata addresses before fetching.',
      'Prefer an allowlist of hosts where the feature permits it.',
      'Disable redirects, or re-check each redirect target.',
    ],
  },
  'pentest.injection_review': {
    label: 'Injection / XSS',
    kind: 'security',
    severity: 'critical',
    action: 'Parameterize queries; never render untrusted HTML raw',
    steps: [
      'Replace hand-built SQL or filter strings with parameters, or escape every interpolated value.',
      'Never pass user input to a shell.',
      'Sanitize (e.g. DOMPurify) anything rendered as raw HTML.',
    ],
  },
  'pentest.security_headers': {
    label: 'Security headers',
    kind: 'security',
    severity: 'medium',
    action: 'Set CSP, HSTS, a strict CORS policy and secure cookie flags',
    steps: [
      'Send Content-Security-Policy, Strict-Transport-Security, X-Content-Type-Options and a frame policy.',
      'Restrict CORS to the known frontend origins — no wildcard with credentials.',
      'Mark session cookies HttpOnly, Secure and SameSite.',
    ],
  },
  'pentest.input_validation': {
    label: 'Input validation',
    kind: 'security',
    severity: 'medium',
    action: 'Limit upload sizes and types; guard against archive bombs',
    steps: [
      'Enforce request and upload size limits at the server.',
      'Check file types by content, not by extension.',
      'Cap the decompressed size and file count when unpacking archives.',
    ],
  },

  // ── org (procedure) ──────────────────────────────────────────────────
  'org.policy_coverage': {
    label: 'Policy coverage',
    kind: 'procedure',
    severity: 'low',
    action: 'Name this system in the information security policy scope',
    steps: [
      'Add this system by name to the scope section of the information security policy.',
      'Get the updated policy approved and record the approval date.',
      'Link the policy document here as evidence.',
    ],
  },
  'org.roles_responsibilities': {
    label: 'Roles and responsibilities',
    kind: 'procedure',
    severity: 'low',
    action: 'Document a named security owner for this system',
    steps: [
      'Name a security owner (and a deputy) for this system in the roles document or RACI.',
      'Link that document here as evidence.',
    ],
  },
  'org.asset_inventory': {
    label: 'Asset inventory',
    kind: 'procedure',
    severity: 'low',
    action: 'Add this system to the asset inventory and SoA',
    steps: [
      'Add the system to the asset register: owner, hosting, data it holds, data classification.',
      'Add it to the Statement of Applicability.',
      'Label its data according to the classification scheme.',
    ],
  },
  'org.access_review_cadence': {
    label: 'Access reviews',
    kind: 'procedure',
    severity: 'low',
    action: 'Schedule and record a quarterly access review',
    steps: [
      'Schedule a quarterly review of admin and privileged accounts.',
      'Record each review (date, reviewer, accounts removed) and link it here.',
    ],
  },
  'org.subprocessor_dpa': {
    label: 'Supplier agreements (DPAs)',
    kind: 'procedure',
    severity: 'low',
    action: 'Collect signed DPAs from every subprocessor',
    steps: [
      'List every third party this system sends customer data to (hosting, database, LLM providers, email).',
      'Download or sign each one’s DPA and store it with the supplier record.',
      'Review the list yearly and whenever a new supplier is added.',
    ],
  },
  'org.incident_response_plan': {
    label: 'Incident response plan',
    kind: 'procedure',
    severity: 'low',
    action: 'Name this system and its escalation path in the IR plan',
    steps: [
      'Add this system to the incident response plan: on-call contact, escalation path, who notifies customers and authorities.',
      'Run a short tabletop exercise and record the outcome.',
    ],
  },
  'org.business_continuity': {
    label: 'Business continuity',
    kind: 'procedure',
    severity: 'low',
    action: 'Run a restore drill and record the evidence',
    steps: [
      'Restore the latest backup into a scratch environment and time it.',
      'Record RPO/RTO achieved and the date, and link the record here.',
      'Repeat at least yearly.',
    ],
  },
  'org.legal_regulatory_requirements': {
    label: 'Legal and regulatory requirements',
    kind: 'procedure',
    severity: 'low',
    action: 'List the applicable regulations and map them to controls',
    steps: [
      'Identify the regimes that apply to this system’s data (GDPR, HIPAA, FDA 21 CFR Part 11, contractual terms).',
      'Map each requirement to the controls that meet it, in a register.',
      'Review the register yearly.',
    ],
  },
  'org.employee_screening_training': {
    label: 'Screening and training',
    kind: 'procedure',
    severity: 'low',
    action: 'Confirm staff with access are in the HR screening/training programme',
    steps: [
      'Confirm everyone with access to this system has signed an NDA and completed security training.',
      'Link the training record here.',
    ],
  },
  'org.physical_security': {
    label: 'Physical security (hosting)',
    kind: 'procedure',
    severity: 'low',
    action: 'Collect the hosting providers’ ISO 27001/SOC 2 certificates',
    steps: [
      'Download the current ISO 27001 certificate or SOC 2 report from each hosting provider.',
      'Store them with the supplier records and link them here.',
    ],
  },
};

const OPEN_STATUSES: ReadonlySet<Iso27001Status> = new Set(['fail', 'partial', 'blocked']);

/** `check.id (status): text` — one segment of the evidence the skill writes. */
const EVIDENCE_SEGMENT = /^([a-z]+\.[a-z_]+) \((pass|partial|fail|blocked|not_applicable)\):/;

function guidanceFor(checkId: string): CheckGuidance {
  const known = CHECKS[checkId];
  if (known) return known;
  const procedure = checkId.startsWith('org.');
  return {
    label: checkId,
    kind: procedure ? 'procedure' : 'security',
    severity: procedure ? 'low' : 'medium',
    action: 'Review the finding and close the gap it describes',
    steps: ['This check has no recommendation yet — add one in src/lib/iso27001-guidance.ts.'],
  };
}

function lower(p: Iso27001Priority): Iso27001Priority {
  return PRIORITY_ORDER[Math.max(0, PRIORITY_ORDER.indexOf(p) - 1)];
}

/** Per-check status as the evidence text records it. */
function checkStatuses(evidence: string | null): Map<string, Iso27001Status> {
  const out = new Map<string, Iso27001Status>();
  for (const seg of (evidence ?? '').split(' | ')) {
    const m = EVIDENCE_SEGMENT.exec(seg.trim());
    if (m) out.set(m[1], m[2] as Iso27001Status);
  }
  return out;
}

export interface Iso27001Recommendation {
  checkId: string;
  label: string;
  kind: Iso27001GapKind;
  priority: Iso27001Priority;
  status: Iso27001Status;
  action: string;
  steps: string[];
}

export interface Iso27001Assessment {
  /** null when the control is compliant or not applicable. */
  priority: Iso27001Priority | null;
  /** 'procedure' only when every open check is a procedure one. */
  kind: Iso27001GapKind | null;
  /** Open checks, highest priority first. */
  recommendations: Iso27001Recommendation[];
}

export function assessControl(control: {
  status: Iso27001Status;
  check_ids: string[];
  evidence: string | null;
}): Iso27001Assessment {
  if (!OPEN_STATUSES.has(control.status)) return { priority: null, kind: null, recommendations: [] };

  const statuses = checkStatuses(control.evidence);
  const recommendations: Iso27001Recommendation[] = [];
  for (const id of control.check_ids) {
    // When the evidence breaks checks out, one it doesn't mention produced no
    // finding. Only evidence with no breakdown at all lends every check the
    // control's own status.
    const status = statuses.size ? statuses.get(id) : control.status;
    if (!status || !OPEN_STATUSES.has(status)) continue;
    const g = guidanceFor(id);
    const priority = g.kind === 'procedure' ? 'low' : status === 'fail' ? g.severity : lower(g.severity);
    recommendations.push({ checkId: id, label: g.label, kind: g.kind, priority, status, action: g.action, steps: g.steps });
  }
  recommendations.sort((a, b) => PRIORITY_ORDER.indexOf(b.priority) - PRIORITY_ORDER.indexOf(a.priority));

  if (recommendations.length === 0) {
    // Open, but no check explains why (no automated check covers this control).
    return {
      priority: 'low',
      kind: 'procedure',
      recommendations: [
        {
          checkId: '',
          label: 'Manual review',
          kind: 'procedure',
          priority: 'low',
          status: control.status,
          action: 'Document how this control is met and link the evidence',
          steps: ['No automated check covers this control. Write down how it is met, link the evidence, and resolve it here.'],
        },
      ],
    };
  }

  return {
    priority: recommendations[0].priority,
    kind: recommendations.some((r) => r.kind === 'security') ? 'security' : 'procedure',
    recommendations,
  };
}
