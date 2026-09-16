---
name: compliance-audit
description: Runs an ISO 27001:2022 (and later SOC2) compliance audit for a tool/repo — scans code, Supabase, Fly.io, Vercel config, does a static/config-based pentest pass, asks the user for evidence on anything that can't be scanned, and produces a ledger + report. Use when the user asks to audit, check compliance, or get a tool "audit-ready" for ISO 27001/SOC2.
revision: 1.1.0
---

# Compliance Audit Skill

Cross-project, framework-agnostic compliance auditing modeled on how platforms like
Cypago work: connectors pull evidence from each surface, a control registry maps that
evidence to framework controls, a ledger tracks status over time, and a report
surfaces what's covered vs what still needs the user's input. The company's org-wide
ISMS is assumed to already exist — this skill audits whether a *specific tool* is
actually in scope and compliant, not whether the company's ISO 27001 program exists.

Same design philosophy as this project's own security-fix tracking pattern
(`SECURITY_FIXES.md` in Orcanos QMS): a status ledger that gets updated in place, not a
fresh wall of text every run.

## Files in this skill
- `controls/iso27001-2022-annex-a.yaml` — the 93 Annex A controls, each mapped to check_ids.
- `controls/soc2-tsc.yaml` — add when the user is ready for SOC2 (see § Adding SOC2).
- `checks/registry.yaml` — the actual work items: connector, automation type, what "pass" means.
- `connectors/{code,supabase,fly,vercel,pentest,org}.md` — exactly how each connector performs its checks.

## Where this skill lives, and where its output goes

**Source of truth: `account-management/.claude/skills/compliance-audit/`** (repo
`zoharp/account-management`), next to the ISO 27001 screen that consumes its results.
`~/.claude/skills/compliance-audit` should be a directory junction to that folder, so the
skill is available when Claude Code runs in any repo — never a separate copy to keep in sync.

Everything per-system lives in account-management too, not in the audited repo:

```
account-management/compliance/systems/<key>/
  scope.yaml        what to scan and where the repo is
  ledger.json       carried-forward status per control (this skill writes it)
  ISO27001_REPORT.md
```

`<key>` must be a key in `account-management/src/lib/iso27001-systems.ts`
(`orcanos-qms` = Ask Paul, `traceability-matrix` = Traceability). A system that isn't listed
there cannot be imported. Adding one: a line in that file + a `scope.yaml` here.

### `scope.yaml`

```yaml
system_key: orcanos-qms              # matches lib/iso27001-systems.ts
system_name: "Ask Paul (Orcanos QMS)"
repo_path: "C:/AI Projects/Orcanos QMS"   # the code connector reads this checkout
github_repo: zoharp/orcanos_qms_AI
frameworks: [iso27001-2022]        # add soc2-tsc once onboarded
connectors:
  code: true
  supabase: true
  fly: false
  vercel: true
  pentest: true      # static/config only — see connectors/pentest.md
credentials:          # env VAR NAMES only, never actual values — read at run time
  supabase_management_token_env: SUPABASE_ORG_ACCESS_TOKEN
  fly_api_token_env: FLY_API_TOKEN
  vercel_api_token_env: VERCEL_API_TOKEN
```

If the system has no `scope.yaml` yet, create it with the user (ask which connectors
actually apply — don't assume Fly/Vercel/Supabase apply) before the first run.

## Running an audit

This is a genuine multi-agent orchestration task — parallel connectors each producing
independent findings, then a synthesis pass — so use the **Workflow tool**, not manual
sequential agent calls. Rough shape:

```js
phase('Scan')
const connectorResults = await parallel(
  enabledConnectors.map(name => () => agent(connectorPrompt(name), {
    phase: 'Scan', label: `scan:${name}`, schema: CONNECTOR_RESULT_SCHEMA,
  }))
)
phase('Synthesize')
const controlStatus = mapChecksToControls(connectorResults.filter(Boolean), controlsRegistry)
// org.* attestation checks: batch into one AskUserQuestion-driven pass, not per-item
```

Read the relevant `connectors/*.md` file into each connector agent's prompt — that file
IS the agent's instructions, don't re-derive them from scratch each run.

## Result schema

Every connector check returns:
```json
{
  "check_id": "code.secret_scanning",
  "status": "pass | fail | partial | blocked | not_applicable",
  "evidence": [{"file": "backend/api.py", "line": 240, "note": "..."}],
  "finding": "one-sentence description if status != pass",
  "recommendation": "concrete fix, if applicable"
}
```
`attestation` checks (org connector) use the same shape; `evidence` holds the
attestation text or document reference instead of a file:line.

## Ledger (`compliance/systems/<key>/ledger.json`)

One entry per control_id, carried forward across runs and updated in place. This is the
exact shape `POST /api/iso27001/runs` accepts — keep every field:
```json
{
  "framework": "iso27001-2022",
  "last_run": "2026-09-15",
  "controls": {
    "A.8.5": {
      "title": "Secure authentication",
      "theme": "Technological",
      "status": "fail",
      "check_ids": ["code.authentication_review", "pentest.auth_flow_abuse"],
      "evidence": "code.authentication_review (partial): … | pentest.auth_flow_abuse (fail): …",
      "last_checked": "2026-09-15",
      "history": [{"date": "2026-07-29", "status": "fail", "note": "initial audit run"}]
    }
  }
}
```
- `title`/`theme` come from `controls/iso27001-2022-annex-a.yaml`; all 93 controls, every run.
- `evidence` is one line per contributing check, `check_id (status): finding`, joined with
  ` | `. It is what an operator reads on the screen — without it a control shows no reason.
  Never put a secret value in it.
- Never duplicate a control's row across runs — update in place and append to `history`
  only on a status *change*.

## Import the run into account-management

The ledger file is not the record — the platform database is. After writing the ledger,
tell the user to open **https://accounts.orcanos.ai/iso27001** (or `localhost:3100` in dev),
pick the system, and use **Import run** with `compliance/systems/<key>/ledger.json`.

An import saves the run as an immutable snapshot, refreshes the current status, and never
touches an operator's answers. Every past run and every answer stay browsable there — so
`org.*` attestations the user already answered on the screen are the first place to look
before re-asking them in a new run.

## Report

Generate **both**:
1. `compliance/systems/<key>/ISO27001_REPORT.md` — git-tracked, diffable, same tone as
   `SECURITY_FIXES.md`: a table per theme (Organizational/People/Physical/
   Technological), status, evidence citation, what's still needed.
2. An HTML Artifact dashboard (via the Artifact tool — load `artifact-design` skill
   first) — overall %-compliant, per-theme breakdown, drill-down per control. This is
   the shareable/readable view; the Markdown file is the source of truth.

Overall status categories to summarize: **Compliant** (pass), **Compensating control**
(mitigated but not textbook — mirrors this project's `⏭️ Mitigated via ...` pattern),
**Gap — action needed**, **Blocked** (missing credential/connector), **N/A**.

## Adding SOC2 later

Create `controls/soc2-tsc.yaml` (Trust Services Criteria: CC1–CC9 Common Criteria, plus
Availability/Confidentiality/Processing Integrity/Privacy if in scope) using the exact
same check_ids already defined in `checks/registry.yaml` wherever they apply — SOC2's
CC6.x (logical access) and CC7.x (system operations) overlap heavily with ISO Annex A
8.x. Add new check_ids only for genuinely SOC2-specific requirements (e.g. formal
vendor risk assessment cadence). Don't re-run connectors per framework — one scan run
updates both frameworks' ledgers from the same evidence.

## Safety rules
- Credentials are always read from env vars named in `scope.yaml` — never ask the user to paste a token into chat, never print a token/secret value into a report or ledger.
- Pentest connector is static/config-only by default (see `connectors/pentest.md`) — no live traffic to any target without an explicit, per-run, user-named test URL and confirmation.
- This skill reports gaps; it does not silently fix code. If a run turns up a fixable code issue, say so and ask/act per the project's own CLAUDE.md rules (most projects: routine reversible fixes just get made and reported, not asked-permission-for) — but a compliance-audit run itself is a *reporting* pass, not a fix-it pass.
