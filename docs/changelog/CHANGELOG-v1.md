# Changelog — account-management v1.x

Long-form release history. The short, user-facing list is
[`release_notes.json`](../../release_notes.json), which is what the app's release-notes modal
renders; the one-line index is [README.md](README.md). v0.x history is in
[`CHANGELOG-v0.md`](CHANGELOG-v0.md).

Newest first.

---

**1.8.0** (2026-10-21) — **Software BOM licence switch.** traceability-matrix 4.30.0 added the Software BOM with its OWN licence, `account_access.allow_sbom` (opt-in, default 0); it opens the BOM module on its own, and the hardware BOM still needs `allow_bom`. New `ModuleKey` `sbom` (catalog label *SBOM*), `moduleFlag` / `supportsSbom` / `setTraceModules`, the modules route's column map, `supports_sbom` on the list, the *Software BOM (SBOM)* tick and the trace PUT; an instance without the column gets a 409, never a silent drop. `hasReachableModule` counts `allow_sbom` (an SBOM-only tenant reaches a module), and so does the panel's *at least one module* check. Verified: `tsc --noEmit` clean.

**1.7.0** (2026-10-16) — **GitHub licence switch.** traceability-matrix 4.28.0 gave its Integrations module a GitHub connector with its OWN licence, `account_access.allow_github` (opt-in, default 0); `allow_integrations` stays Jira, either opens the module, each connector needs its own. New `ModuleKey` `github` (catalog label *GitHub*), `moduleFlag` / `supportsGithub` / `setTraceModules`, the modules route's column map, `supports_github` on the list, the *Integrations (GitHub)* tick and the trace PUT; an instance without the column gets a 409, never a silent drop. Saves spread the stored row, so an older console keeps `allow_github` as stored. Verified: `tsc --noEmit` clean.

**1.6.1** (2026-10-16) — **New accounts start with 510(k) and MDSAP off.** Both create paths
(`POST /api/accounts` without provisioning, and `tickSavingAccount` in `lib/provisioning.ts`) now
write `regulatory_modules: NEW_ACCOUNT_REGULATORY` (`lib/module-catalog.ts`, all three `false`)
into the new row. `REGULATORY_DEFAULTS` and Ask Paul's `REGULATORY_MODULE_DEFAULTS` are deliberately
unchanged: they are what every existing account with no stored key reads as, so flipping them would
have turned 510(k)/MDSAP off for all of those accounts. Needs `sql/007` (already applied since 1.4.0).

---

**1.6.0** (2026-10-15) — **Integrations (Jira) licence.** `account_access.allow_integrations`
(traceability-matrix 4.25.0) is now switchable here, wired exactly like Risk (1.3.0): module key
`integrations` (label **Jira**) in `module-catalog.ts`, `moduleFlag` / `supportsIntegrations` /
`newTraceAccountRow` / `upsertTraceModules` in `lib/trace.ts`, `mergeAccounts`, the module pill route,
`/api/accounts/trace/[tenant]` GET + PUT, and the Traceability tab tick. OPT-IN: an absent column reads
as OFF; turning it on against an instance older than 4.25.0 answers 409 instead of being silently dropped.
It does not count as a reachable module (an account with only Jira still needs Traceability or another
module to sign in to). **Only the licence switch lives here** — every Jira credential (Atlassian app, API
token, the integration's Orcanos user) is entered on the account's own Integrations screen in the trace
app and stored encrypted under that account's `account_id`. The create-account form does not offer it;
switch it on after creation.

---

**1.5.0** (2026-10-15) — **Credits setting, one for all accounts.** New `sql/008_platform_settings.sql`
(master DB, table `platform_settings`, seeded `credits` = `{credits_per_usd: 100, markup: 1.0}`), new
`/credits` page + nav item, `GET/PUT /api/settings/credits` (platform staff only, audited as
`platform_setting_changed`, 409 naming the migration when the table is missing). Ask Paul reads the row
(30 s cache) and shows customers credits = cost USD x markup x credits per $1, computed at read time, so a
change re-prices history. `GET /api/accounts/:id/usage-logs` returns `total_credits` and the Spend tab
shows it beside the $ figure. Defaults are mirrored in Ask Paul's `CREDIT_DEFAULTS` — change both together.

---

**1.4.2** (2026-10-14) — **Modules popover no longer truncates at the bottom of the screen.**

The popover flipped above its trigger only when its *whole* height fitted above. With nine switches
(and two-line blocked reasons) it is taller than either half of a laptop viewport, so for any row near
the middle neither side fitted, it stayed below, and the lower switches ran off-screen with no way to
reach them — the page scroll closed it.

- `ModulesCell` now opens below if it fits, else above if it fits, else on the roomier side with
  `max-height` set to that space; `.acl-mods-pop` scrolls (`overflow-y: auto`,
  `overscroll-behavior: contain`). Height is measured with `scrollHeight`.
- The capture-phase scroll listener that closes the popover ignores scrolls originating inside it —
  otherwise the first wheel tick on the new scrollable list would have closed it.
- Typecheck and build only; not checked in a browser.

---

**1.4.1** (2026-10-13) — **Create an Ask Paul database from a traceability-only tenant.**

A tenant that exists only in traceability has no master `accounts` row, so the Ask Paul tab never
rendered the *Vector DB* section — yet its licence warning told the operator to "fill in the Vector DB
section below". There was no in-dialog way to get Ask Paul onto such a tenant; the Create account form
would work but sends every module tick, rewriting the tenant's existing licences.

- `AskPaulPanel` (trace-only branch) gains **Create Ask Paul database**: `POST /api/accounts` with
  `account_name = tenant`, the row's region, `provision: true` and `modules: {}`. An absent module key
  leaves that licence alone (`upsertTraceModules`), and the route already adopts a same-region
  trace-only tenant. It drives the same resumable job as the create modal (4 s poll; *Retry* resumes
  a failed job rather than billing a second project).
- Blocked with an explanation when the row has no tenant or no region. EU tenants get a warning that
  the EU deployment has no Ask Paul hand-off yet.
- The licence warning now points at the right control for each case.
- `AccountsClient` re-points the open account window at the fresh row after every reload (by tenant
  for a row that gained a master id, else by key). Before, the window kept its stale snapshot, so a
  tenant that just became an account still showed as trace-only until reopened.
- `findResumableJob` skips a failed job whose Supabase project answers **404**. pcure's 2026-08-31
  job still pointed at `klrgfaddrnnawvagomxr`, which had since been deleted, so every new create for
  the name tried to "resume" it and was refused ("already created in the US region … delete the
  project in Supabase first" — it already was). Any answer other than a definite 404 still resumes,
  since wrongly skipping a live job bills a second project.
- **Verified 2026-10-14 in production:** pcure (EU, traceability-only) went through the button — job
  `done`, account `389b1ec7-…` active in `eu`, project `askpaul-pcure` (`eqpjdpshfltlqtxxskgk`) in
  eu-central-1. The first end-to-end provisioning run recorded. The EU deployment still has no Ask
  Paul hand-off, so pcure users do not see the button yet.

---

**1.4.0** (2026-10-13) — **Per-account show/hide for Ask Paul's regulatory modules.**

510(k), MDSAP and the new Standards workspace are sub-modules of Ask Paul with no traceability licence,
so their switch lives only in the master `accounts` row, not in `account_access`.

- `sql/007_regulatory_modules.sql` adds `accounts.regulatory_modules jsonb not null default '{}'`.
  A missing key means the default (`REGULATORY_DEFAULTS` in `lib/module-catalog.ts`): `fda_510k` and
  `mdsap` ON, `standards` OFF, so applying the migration changes nothing by itself. Ask Paul mirrors
  the defaults in `REGULATORY_MODULE_DEFAULTS` (`backend/api.py`); change both together.
- `PUT /api/accounts/modules` handles the three keys before any traceability logic: it needs
  `account_id` (409 without a master row), read-modify-writes the jsonb so one toggle never drops another,
  and writes `account_module_changed`. A missing column answers 409 "run sql/007 first".
- The accounts list reads `regulatory_modules` in a separate, tolerant query, so an unapplied migration
  cannot blank the page.
- `ModuleKey` gained `RegulatoryModuleKey`; `MODULE_COLUMN` excludes it. Enforcement is in Ask Paul
  (403 on the module's routes, cached 30 s) — hiding here is not just cosmetic.
- Not done: agent tools for a hidden module are still offered.

---

**1.3.1** (2026-10-12) — **An account created without an Orcanos URL is listed once.**

Create keys the traceability `account_access` row on `traceTenantForAccount()`, which falls back
to the account name when there is no `orcanos_api_url`. The list's merge (`tenantOf` in
`lib/modules.ts`) had no fallback — no URL meant no tenant — so the master row never claimed the
row its own create had just written. Result: two rows per such account, one master-only showing
no modules and one "trace-only" carrying the licences. Seen on 2026-10-12 (`equashield`: one
`account_created` event, `tenant_from: account_name`; the purge removed one master row and one
trace row).

- `tenantOf` now delegates to `traceTenantForAccount`, so the merge, `askPaulDatabaseExists`
  and `GET /api/accounts/trace/:tenant`'s master lookup all use the rule create and delete
  already used. `askPaulDatabaseExists` selects `account_name` for it.
- Side effect, intended: an account with no Orcanos URL now has a tenant (its name), so its
  module switches are no longer disabled with "set its Orcanos API URL first" — they write the
  row create made.
- Verified with `mergeAccounts` on the `equashield` shape: one row, `trace` + `risk` on.

---

**1.3.0** (2026-10-08) — **Risk Management licence.**

traceability-matrix 4.12.0 added the Risk Management module, licensed by
`account_access.allow_risk` (opt-in, default 0). It is now managed here exactly like Doc Review:

- `ModuleKey` gains `risk`; `MODULES` lists it (so the accounts-list popover shows a *Risk*
  switch and the count reads `n/6`); `mergeAccounts` reports it; Overview shows its state.
- `moduleFlag()` reads an absent `allow_risk` as OFF; `hasReachableModule()` counts it, so a
  Risk-only tenant is a valid licence.
- `supportsRisk()` detects the column. On an older instance every write path
  (`PUT /api/accounts/modules`, `PUT /api/accounts/trace/:tenant`, create via
  `upsertTraceModules`) refuses a Risk change with 409 rather than letting it be silently
  dropped; the list shows why the switch is disabled, and the Traceability tab hides the tick.
- Create form: *Risk Management* checkbox, never pre-ticked.

---

**1.2.0** (2026-10-06) — **Accounts list: modules in a popover.**

Five modules as one clickable pill each wrapped every row onto two lines, and an unlicensed
module took as much room as a licensed one.

- **Modules cell** shows only licensed modules (read-only pills) plus an `n/5 ▾` count. The
  whole cell opens a popover (`ModulesCell` in `AccountsClient.tsx`) with one switch per
  module. Unchanged rules: a module with no source row is a hatched dash, not off; a switch
  that cannot be written is disabled, and its `disabledReason` is now visible text under it,
  not only a tooltip. `scopeNote` (e.g. "this also ADDS the tenant to the allowlist") is shown
  the same way, before the click.
- The popover is `position: fixed`, flips above the trigger when there is no room below, and
  closes on outside click, Escape, scroll or resize.
- A refresh no longer swaps the table for "Loading…" once rows exist, so the popover stays
  open while several modules are toggled one after another.
- **Tenant column removed** — it repeated the account name on every row since the 2026-08-29
  rename. The tenant is shown under the name only when it differs. Search still matches it.
- **"Trace only" badge removed.**
- **Region** shows `US` / `EU` (`REGION_LABELS[*].short`); the full name is in the tooltip.
  Modals keep the long form.
- **Manage…** is a gear icon button (`.btn-icon`) with an `aria-label`.

---

**1.1.1** (2026-10-01) — **New accounts get orca60's schema.**

`sql/bootstrap_new_account.sql` was a hand copy of the QMS file taken at the 2026-08-28
extraction and never updated, so every account created since got none of QMS per-account
migrations `010`–`041` (agents, proposals, SOP rules, 510(k), DHF, RLS, diff analyses,
repository visibility, MDSAP, section metadata). QMS's deploy-time runner would eventually
have applied them, but only on the next QMS deploy, and — with no `schema_migrations`
ledger in the bootstrap — by replaying everything from `003`. `orcanosdemotest`
(created 2026-09-30) is in that state: 16 tables, no ledger.

- **orca60 is the schema master.** New `scripts/snapshot-bootstrap.mjs` reads its live DB
  (Management API) and regenerates the bootstrap: 45 tables, sequences, FKs, indexes,
  6 functions, RLS flags, reference rows, and orca60's 35 ledger rows (latest
  `041_standard_section_metadata.sql`). `agent_definitions` and tenant content excluded.
- **Verified** on a local Postgres 17 + pgvector container set up like Supabase: applies
  cleanly, re-applies cleanly (resume path), and a fingerprint of columns, defaults,
  constraints, indexes, function bodies, RLS, reference-row hashes and ledger matches
  live orca60 line for line (858 lines). Not yet run by a real provisioning job.
- **Drift check.** `saving_account` compares the new DB's `schema_migrations` with
  orca60's and appends any missing filenames, plus the fix, to the job message. Non-fatal.
- `outputFileTracingIncludes` now pins the bootstrap to the provision tick route.

---

**1.1.0** (2026-10-01) — **Delete an account, all of it.**

The only delete was the Ask Paul tab's, which removed the master record and left the traceability
tenant and the Supabase project behind (CLAUDE.md behaviour #8). New: account window → *Overview*
→ *Delete this account…*, typed `DELETE` → `POST /api/accounts/delete`
(`{account_id, tenant, confirm: "DELETE"}` — the word is re-checked server-side).

Order, stopping at the first failure:
1. **Traceability** — `purgeTenant` in the region that holds it (every `account_id`- and
   `account`-keyed table, `account_access` and AI config included), then `deleteRegionDirectory`
   (new, `lib/trace.ts`) on every region, since the purge skips `account_region`.
2. **Supabase** — `deleteSupabaseProject` (new, `lib/provisioning.ts`, Management API
   `DELETE /v1/projects/:ref`) for the ref in `vector_db_host`/`db_host` plus every `project_ref`
   on the name's `account_provisioning` rows. 404 = already gone.
3. **Master** — `account_llm_keys`, `auth_methods`, `account_usage_logs`, `account_provisioning`,
   then `accounts` **last** so a partial run stays visible and can be re-run.

Refused (409): `PLATFORM_ACCOUNT`; a tenant another master account derives; a client tenant that
differs from the server-derived one. Skipped with a warning: the master project and any project
another account points at. Kept: `security_audit_log` (new event `account_purged`, with every
step) and `users` (global). The Ask Paul tab's `DangerZone` is removed;
`DELETE /api/accounts/:id` stays for QMS parity but no button calls it.

⚠️ **Untested against live data** — built, typechecked and `next build` green only. The
Supabase project-delete response and the trace purge from Vercel have not run end to end.

---

**1.0.2** (2026-10-01) — **One tenant, one account.**

Reported: two `orcanosdemotest` rows in the accounts list after the 1.0.1 resume. Master held
**one** row (verified; `accounts_account_name_key` is unique), so the second row came from the
list's join, which matches master to traceability on the **tenant**, not the name
(`mergeAccounts`). Not confirmed which row was the stray — reading production's traceability
instances from a dev machine was not permitted.

`POST /api/accounts` now refuses, with 409 and before anything is written or billed:
- a tenant (`traceTenantForAccount`, compared case-insensitively) that another master account
  already derives — two master rows on one tenant;
- a tenant `findTraceAccount` finds in the **other** region — the master row and the existing
  trace row would never join. The same region is allowed: that is adopting a trace-only tenant.

An unreachable traceability instance skips the second check (logged) rather than blocking every
create.

---

**1.0.1** (2026-10-01) — **Create resumes the failed job for that name.**

1.0.0's *Retry* lives only in the dialog that started the job; close it and the job is
unreachable, and Create asks Supabase for a second `askpaul-<name>` project, which it refuses.
Hit on `orcanosdemotest` straight after the 1.0.0 deploy.

- `POST /api/accounts` (provision path) first calls `findResumableJob(name)` — newest
  `account_provisioning` row for the name (case-insensitive) in `error` with a `project_ref` and no
  `account_id`. If there is one, `resumeWithPayload()` merges the submitted form over the job's
  stored payload (so a blank password keeps the one typed first time) and calls
  `retryProvisioning()`; the response is the same `202 {job}` and the modal polls it as usual.
  Audited as `account_provisioning_retried`.
- **The region cannot change on resume** — the project already lives in one. A mismatch answers
  409 naming the region, rather than recording the account somewhere its database is not.

---

**1.0.0** (2026-09-30) — **First 1.x release.** **Provisioning's schema step works from Vercel; failed jobs resume.**

`running_schema` failed every time with `getaddrinfo ENOTFOUND db.<ref>.supabase.co`: that host
publishes only an AAAA record and Vercel functions are IPv4-only (the trap recorded since
2026-08-31). Hit again on a real run on 2026-09-30, leaving project `aiydgrmdhecxwnzlddmd` created
with no schema and no account.

- `tickRunningSchema` (`src/lib/provisioning.ts`) no longer opens a `pg` connection. It POSTs the
  whole of `sql/bootstrap_new_account.sql` to
  `https://api.supabase.com/v1/projects/<ref>/database/query` with the org token the other steps
  already use — the same route master migrations are applied through. Chosen over the pooler
  (`aws-0-<region>.pooler.supabase.com`, user `postgres.<ref>`) because the pooler's host prefix
  varies per project and would have to be looked up or guessed; the query route has no such
  dependency. The generated DB password is no longer read after project creation. Verified: the
  route answers Node `fetch` (`201`) against the new project — no Cloudflare 1010, which only hits
  urllib's User-Agent.
- **Resume, not restart.** `retryProvisioning()` moves a job in `error` that has a `project_ref`
  and no `account_id` back to `running_schema` (service key already fetched) or `fetching_keys`.
  `POST /api/accounts/provision/:jobId` with `{ "retry": true }` calls it, audits
  `account_provisioning_retried`, then ticks as usual; a non-resumable job answers 409. The create
  modal replaces *Create* with *Retry* for such a job. Pressing Create again was the wrong
  recovery: Supabase refuses the second project with the same name and the first stays billed.
- `sql/bootstrap_new_account.sql` is all `if not exists` / `or replace`, so re-running it on retry
  is safe.
- `pg` stays a dependency — `lib/connections.ts` still uses it for the vector DB test.
