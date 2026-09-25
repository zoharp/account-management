# Changelog — account-management v0.x

Long-form release history. The short, user-facing list is
[`release_notes.json`](../../release_notes.json), which is what the app's release-notes modal
renders; the one-line index is [README.md](README.md).

Newest first. Per the `release-management` convention, `CLAUDE.md` keeps only the current
version and any trap that fails silently — not this.

---

**0.12.1** (2026-09-25) — **Non-admin sign-in says why.**

`POST /api/auth/local/login` now answers a successful `QW_Login` whose
`Is_admin` is false with `403 Only Orcanos administrators can sign in to the
platform console.` instead of `401 Invalid credentials`. No enumeration cost:
the password has already been accepted by Orcanos at that point. The login
screen shows the message and clears the password field. Audit reason is
unchanged (`orcanos_not_admin`).

---

**0.12.0** (2026-09-25) — **The infrastructure handbook, inside the console.**

New sidebar item **Handbook** (`/handbook`) framing the slide-deck version of
`docs/platform/ORCANOS_AI_INFRASTRUCTURE.md`, which was brought up to date in the same change
(Traceability 4.7.0, Ask Paul 2.65.0, this app 0.12.0 — see the handbook's *Latest change* row).

- `GET /api/handbook` (`src/app/api/handbook/route.ts`) — `requirePlatformStaff()` first, then
  reads `docs/platform/orcanos-ai-infrastructure.html` from disk and returns it with
  `Cache-Control: private, no-store`. Deliberately **not** a `public/` file: this app has no
  middleware, so anything in `public/` would bypass the staff gate, and the deck names hosts,
  secrets-by-name and open risks.
- `next.config.mjs` — `outputFileTracingIncludes` ships the HTML into the Vercel function
  (nothing imports it, so the tracer would drop it); and a second `headers()` entry for
  `/api/handbook` only, **after** the catch-all, relaxing `frame-ancestors 'none'` /
  `X-Frame-Options: DENY` to `'self'` / `SAMEORIGIN`. Next keeps the later entry when two set the
  same key. The deck has no controls that act on data, so being framable by this origin adds no
  clickjacking surface. **Nothing that writes may ever get this relaxation.**
- `src/app/handbook/page.tsx` — the usual server-side staff check, `AppShell active="handbook"`,
  an iframe (the deck's global CSS — `body{overflow:hidden}`, fixed chrome — would take over the
  console if inlined) and an *Open full screen* link to the same route.

To update the deck: edit the HTML (and the markdown), deploy. No build step.

---

**0.11.0** (2026-09-25) — **Open Ask Paul / Traceability from each account row.**

The accounts list's Actions column gains two links beside *Manage…*: **Ask Paul ↗** and
**Traceability ↗**. Each opens the product's front door in a new tab (`noopener noreferrer`) for
the row's region — `coerceRegion(row.region)`, so a row with no region is US. Nothing about the
account is carried: no tenant, no session, no `?u=` prefill. The product's own sign-in decides.

URLs live in `APP_URLS` in `src/lib/regions.ts` (client-safe):

| | US | EU |
|---|---|---|
| Ask Paul | `https://askpaul.orcanos.ai` | *none — button disabled* |
| Traceability | `https://traceability.orcanos.ai` | `https://eu.traceability.orcanos.ai` |

EU Ask Paul is `null`, not the US address — same no-fallback rule as `traceApiUrlFor`. When an
EU Ask Paul is deployed, set it there.

---

**0.10.0** (2026-09-24) — **ISO 27001: priority and a recommendation for every open control.**

New `src/lib/iso27001-guidance.ts` holds one entry per `compliance-audit` check (all 40 in
`checks/registry.yaml`): gap kind (`procedure` for `org.*` attestations, `security` for
code/Supabase/Fly/Vercel/pentest), a base severity, a one-line action and concrete steps.
`assessControl()` reads each check's own status out of the evidence text
(`check.id (status): …`, joined by ` | `) and rates it:

- procedure → always **low**;
- security → the check's severity when it **failed**, one level lower when **partial** or
  **blocked**;
- control → the highest of its open checks; compliant/N/A → none.

A check listed in `check_ids` that the evidence does not mention produced no finding and is
skipped. Only evidence with no per-check breakdown lends every check the control's status.
Without that rule A.8.29 on Ask Paul read Critical from an SSRF check that had reported nothing.

Nothing is stored. The rating is derived on read, so it works on saved runs and needs no migration.
To re-rate a check or change its advice, edit `CHECKS`. The screen gains Priority and
Recommendation columns, a priority filter, a *Sort by priority* option and open-by-priority counts
in the header line; the control dialog gains a *How to fix* section. New `.acl-toggle--crit` pill.

Against the Ask Paul 2026-09-15 run: 13 high, 17 medium, 12 low security, 26 low procedure,
25 compliant/N/A.

---

**0.9.0** (2026-09-16) — **ISO 27001 audits per system, with history.**

Also records the ISO 27001 screen itself (commit `400360d`), which shipped with no version or
release note.

**Two systems.** `ISO27001_SYSTEMS` gains `traceability-matrix`; `orcanos-qms` is labelled Ask Paul.
The screen has a system selector. A system never audited shows how to get its first run in.

**Runs are kept (`sql/006_iso27001_history.sql`).** `iso27001_audit_runs` + `iso27001_run_controls`
hold each imported run and its full control list, immutable. `POST /api/iso27001/runs` validates a
skill `ledger.json` all-or-nothing (`parseLedger`), writes the run and snapshot (deleting the run
again if the snapshot fails), then upserts only the automated columns of `iso27001_controls`
(`pgUpsert`, `merge-duplicates`) — a resolution column is never in the payload, so an import cannot
touch an answer. `iso27001_run_imported` is audited. The screen can open any past run read-only and
marks each control whose status differs from the run before.

**Answers are kept.** `PATCH /api/iso27001/:id` appends to `iso27001_control_notes` *before*
updating the current row, so the row can never hold an answer the history lacks. `resolved: false`
is now sent by the dialog (*Save comment* / *Reopen with comment*). The migration backfills 005's
seed as the first Ask Paul run.

**The `compliance-audit` skill moved into this repo** (`.claude/skills/compliance-audit`), with
per-system scope, ledger and report under `compliance/systems/<key>/`. The Ask Paul ledger was
copied from `Orcanos QMS/compliance/` and given the `evidence` field the import needs.

⚠️ **Deploy order: apply `sql/006` first.** Without it the current view still loads, but run
history is unavailable and every save fails (the note insert is required).

---

**0.8.0** (2026-09-16) — **BOM, the fourth licensable module.**

traceability-matrix 3.46.0 merged the standalone Covaris BOM viewer in as a module, licensed by a
new `account_access.allow_bom` column. This release manages it here, where module licences now
live — the same four surfaces as Training: the list pill (`MODULES` in `lib/module-catalog.ts`),
the Traceability tab tick, the create form tick, and the overview summary.

**It inverts the absent-column rule.** Every other module reads an absent flag as licensed
(`moduleFlag()`, matching `_modules_of`), because every tenant already had those modules when their
columns were added. Nobody had BOM, so `moduleFlag(row, 'bom')` is `Boolean(row.allow_bom)` —
absent is OFF, and the Traceability tab reads it with `on(v, false)`. Reading it the usual way
would show a licence on every account and, because the trace API rewrites the whole row, the next
unrelated save from this console would *write* it. Mirrors `MODULE_DEFAULTS` in the trace app's
`access_control.py`; the new-row defaults (`newTraceAccountRow`, the trace-tab fallback row) carry
`allow_bom: 0` explicitly.

**Silent discard refused, again.** `supportsBom(rows)` (does any row carry `allow_bom`?) gates
every write — `PUT /api/accounts/modules`, `PUT /api/accounts/trace/:tenant`, and
`upsertTraceModules` (create + provisioning) — with a 409 naming 3.46.0. On an older instance the
pill is disabled with that reason and the Traceability tab shows a note instead of the tick.
`TraceSourceStatus.supports_bom` carries it to the list.

**"At least one module" now counts BOM** (`hasReachableModule()` in `lib/trace.ts`, used by both
routes): a BOM-only tenant is a real licence. Ask Paul still does not count.

Existing `allow_bom` values survive edits made elsewhere in the console: `saveTraceAccount` spreads
the whole stored row, so the column round-trips even through paths that never mention it.

**Verified:** `tsc --noEmit` clean. Not run against a live instance — the US/EU traceability apps
are not on 3.46.0 yet, so every BOM control currently shows the "deploy 3.46.0 first" state.

---

**0.7.0** (2026-09-15) — **a Disaster recovery screen, status-only.**

New nav item, `/disaster-recovery`. It calls the Supabase Management API's
`GET /v1/projects/{ref}/database/backups` for every account's project (plus the master project,
derived from `SUPABASE_URL`) and shows PITR enabled/off, the most recent completed backup, and a
per-project health pill — a gap (PITR off, no backup ever recorded, or a backup older than 26h)
reads as "Stale" or "At risk" rather than blending into a healthy list.

Deliberately status-only. There is no backup pipeline of our own yet — see
`Orcanos QMS/design/BACKUP_RECOVERY_PLAN.md`, which treats Supabase PITR as the primary, zero-code
backup mechanism and a nightly logical dump to GCS as the belt-and-suspenders layer, neither of
which is built. This screen exists so the gap is visible before anything is built to act on it. A
restore control is intentionally not part of this cut — restoring is destructive and in-place, and
needs its own confirmation flow (type the account name to confirm, matching this app's other
destructive actions) once there is a real restore path to drive, not a mocked one.

Concurrency-limited to 5 simultaneous Management API calls (`mapWithConcurrency` in the route
handler) so an account list of any size doesn't fan out into a burst that gets rate-limited.
Per-project failures (a bad ref, a Management API hiccup) are carried in the row rather than
failing the whole screen — one broken project shows as "Check failed", the rest still render.

**0.6.1** (2026-09-10) — **account names are unique in the database, not just in the code.**

Three checks refused a duplicate account name before this release and every one of them was a
read followed by a write. `CreateAccountModal` compares against a list the browser loaded at some
earlier point; `POST /api/accounts` runs an `ilike` lookup and then inserts. Between the lookup
and the insert there is a window, and **on the provisioning path that window is minutes wide** —
the name is checked when `startProvisioning` accepts the job, and the `accounts` row is not
written until `tickSavingAccount` runs, after the Supabase project reports healthy.

So two operators creating `acme` a minute apart both passed. That is not a cosmetic collision.
`account_name` is a text key with **no foreign key** in five tables — `auth_methods`,
`account_llm_keys`, `account_usage_logs`, `account_provisioning`, `security_audit_log` — and every
lookup against it takes `rows[0]`. With two rows, which one that is, is arbitrary: one tenant's
LLM key, auth configuration and usage can be read against the other tenant's account.

Three changes, one per layer of the gap:

1. **`sql/004_account_name_unique.sql` — a unique index on `lower(account_name)`.** The only check
   that cannot race. Case-insensitive because every reader already is (`accountCiFilter()` compares
   with `ilike`), so the database now agrees with the code rather than permitting a pair the code
   cannot tell apart. ⚠️ **Outstanding — not yet applied to master.** It deliberately `raise`s,
   naming the offending names, if duplicates already exist: merging them is a hand-run write across
   those five tables and must not be a migration's side effect.
2. **`POST /api/accounts` also refuses a name with an in-flight provisioning job.** During that
   minutes-wide window nothing in `accounts` marks the name as taken — only a job row does. Without
   this the second operator starts a second Supabase project, is billed for it, and the row it was
   created for is then refused by the index.
3. **Both insert sites read `23505` as "already exists".** `isUniqueViolation()` in
   `lib/supabase.ts` detects it (PostgREST puts the SQLSTATE in the body of its 409). The route
   answers the same 409 the pre-check would have. `tickSavingAccount` fails the job with a message
   **naming the orphaned Supabase project** rather than force-writing a row or silently adopting
   the existing account — that project is real and billed, and only an operator can decide whether
   to attach it to the account that won or delete it.

The form's greyed-out **Create** button is unchanged and stays a convenience: it tells the operator
while they are typing rather than after they have filled the whole form in, and it is the only one
of the three that also compares against traceability tenant names.

---

**0.6.0** (2026-09-10) — **the account window is one tab per system, not one per table.**

0.5.0 put everything about an account behind one door. It divided that door up by **where each
setting was stored**, and storage does not match how anyone thinks about a customer. Ask Paul's
licence is a column on the traceability allowlist row, so it appeared inside *Traceability*. Ask
Paul's database and kill switch are columns on the master account, so they appeared under
*Account & databases*. Turning Ask Paul on for a customer therefore meant two tabs, and the rule
joining them — **no database, no Ask Paul** — had to be explained in both, in two copies of the
same paragraph, enforced from four screens. Meanwhile *Traceability* held a second application's
licence, an AI engine and a cost, none of which are traceability.

Six tabs now, each one thing an operator thinks about:

| Tab | What it holds |
|---|---|
| **Overview** | Region, module summary, and the region move — collapsed |
| **Orcanos** | The customer's own Orcanos server: REST API, credentials, the derived tenant, and the direct SQL Server |
| **Traceability** | Access gates, module licences, note — that app and nothing else |
| **Ask Paul** | Licence, kill switch, vector database, and delete |
| **LLM** | Both AI configurations side by side |
| **Spend** | Both AI ledgers |

Points worth keeping:

- **`is_active` is on the Ask Paul tab and says so.** It is read in exactly two places, both inside
  the QMS AI backend; traceability never reads it. Under a generic *Status* label it read as an
  account-level gate, which it has never been — an inactive account still signs in to traceability
  and uses every module it is licensed for.
- **Delete says which of the two apps it destroys.** It removes the master record — the Ask Paul
  account, its database credentials, its LLM key, its sign-in methods — and leaves the traceability
  tenant working. It is also collapsed now, like the region move: both were permanently-expanded
  red blocks on the tab you land on, which is how a screen teaches people to ignore red.
- **The two tabs that read the same trace row save disjoint fields.** The trace `PUT` falls back to
  the stored row for anything omitted, so Traceability sends only its flags and Ask Paul sends only
  `allow_ask_paul` / `ask_paul_account`; neither can clobber the other. This is load-bearing — the
  route was already written this way, but nothing depended on it until now.
- **The direct SQL Server section is honest about being unused.** Tracing it through both
  codebases: `pyodbc` appears in the QMS backend exactly once, inside the test function itself.
  Nothing else on the platform reads those credentials — both apps reach Orcanos through the REST
  API. It is collapsed when empty, and labelled rather than left looking like a skipped step.
- **The Orcanos tab shows the derived tenant.** There is no `orcanos_tenant` column, so the virtual
  directory in that URL is what every module licence is keyed on, and the fallback to the account
  name is a guess. Both are now stated where the URL is edited.

Three components were replaced by six: `AccountDetailModal`, `TraceSettingsModal` and
`AccountBillingModal` became `OrcanosPanel`, `TraceabilityPanel`, `AskPaulPanel`, `LlmPanel`,
`SpendPanel` and a shared `Check`. `ModalShell`'s `embedded` prop is no longer used by them — the
panels are tab bodies now, never windows — but the shell stays for anything that needs a dialog
again. Two duplicated copies of the `ASK_PAUL_NEEDS_DB` string collapsed into one in the new
client-safe `lib/trace-ui.ts`, which also holds the trace row shapes the three tabs share.

No API changed and no data shape changed; every save posts the same payloads to the same routes.

---

**0.5.2** (2026-09-10) — **a region move reports itself while it runs.**

The move takes minutes on a real tenant and, until now, said nothing for all of them: one blocking
`POST`, a disabled button reading *"Moving… this can take a few minutes"*, and the `steps[]` list
only once it was over. For a flow whose **last** step deletes quiz attempts, the several minutes
before that delete is exactly when an operator needs to see where it is — and a silent button is
also the state in which someone reloads the tab.

`POST /api/accounts/move` now answers with **NDJSON**: one line per step transition, terminated by a
`done` or `failed` line carrying what the single JSON body used to carry. The six phases are
unchanged, in the same order, for the same reasons — freeze, export, import, verify, restore,
records, purge — and nothing about the safety properties moved. The panel renders all seven from the
moment the tenant name is typed, so the plan is readable **before** the move is authorised, and
lights each one as the server passes it, with the count it actually moved underneath.

Three things worth knowing about the shape:

- **Validation still answers with real status codes.** Everything decidable before the first write —
  auth, the region, which instance holds the tenant, the two-copies 409 — is ordinary JSON, because a
  status code only exists before the first byte is flushed. After that the transport is always 200
  and the last line is the verdict: **a client that reads `res.ok` and stops has read nothing.** The
  panel switches on the content type.
- **A stream that ends with no verdict is its own error**, and says so loudly rather than looking
  like a failure — that is the serverless-timeout case, the one where re-running blindly is how a
  tenant ends up in both regions at once.
- **There is no percentage.** Export, import and purge are each ONE opaque call to a regional
  instance; none reports a fraction, so a bar could only be an animation. The one piece of motion is
  a pulsing marker on the step genuinely in flight, and it is dropped under
  `prefers-reduced-motion`.

The failing step is now recorded in the audit event too (`failed_at`), which the previous shape
could only imply from how far `steps` got.

New file `src/lib/move-steps.ts` holds the step catalogue and the event union. It is its own
module because `MoveRegionPanel` is a client component and may not import a route.

---

**0.5.1** (2026-09-10) — **the account window's tab strip was being clipped.**

On any tab whose body was taller than the window — Traceability, in practice — the tab labels were
cut in half and the strip grew a horizontal scrollbar of its own, so *Overview*, *Account &
databases*, *Traceability* and *Spend* were half-readable and looked broken.

Two CSS defaults compounded. `.acl-detail-body` is `flex: 1` inside the column-flex panel, but a
flex item's `min-height` defaults to `auto` — *never smaller than my content* — so the body did not
shrink and scroll, it pushed. `.acl-header` was protected with `flex-shrink: 0`; `.acl-tabs`, added
later, was not, so it absorbed the whole overflow. Fixed by giving the body `min-height: 0` and the
strip `flex-shrink: 0`. Both carry a comment saying why, because the symptom appears in a file
nowhere near the cause.

Nothing else changed; no behaviour, no routes, no data.

---

**0.5.0** (2026-09-10) — **one screen per account, the region on the list, and a real move.**

**The row used to be the problem.** It offered *Traceability…*, *Edit* and *Delete* — but which
appeared depended on facts an operator could not see: *Edit* and *Delete* only for accounts with a
**master record**, which most tenants do not have, and *Traceability…* only when the tenant had an
allowlist row. So a full customer showed three buttons, a traceability-only customer showed one, and
nothing on screen explained the difference. Clicking the **account name** now opens one window with
everything that exists for that account as tabs, and a capability the account lacks is a **disabled
tab carrying the reason** instead of a button that silently is not there.

The tabs are the SAME components that used to be separate dialogs, rendered through a new
`ModalShell` with `embedded` so they draw no window of their own. They were not reimplemented — their
save logic, three-state secret handling and invariants stay in one place. Tabs mount lazily and
unmount on leave, so switching back re-reads rather than showing a snapshot from when the window
opened.

**Region on the list.** A column on every row, taken from `MergedAccountRow.region`, which prefers
**the instance the row was read from** over `accounts.region`. That ordering is the point: the
instance holding the rows is where the data physically is; the master column is only what somebody
recorded. When both exist and disagree the row shows a **conflict** badge — one of them is wrong,
nothing here can tell which, and resolving it silently is how a residency claim stays plausible while
being false.

**Moving a customer** (`POST /api/accounts/move`). The only sanctioned way `accounts.region` ever
changes — `PATCH` still refuses the field, because setting it moves nothing.

- Order: freeze the source → export → import → **compare row counts** → restore the tenant's own
  access flag (not a default: a suspended customer stays suspended) → update master and the
  directory in every region → purge the source.
- **A short import stops the move with the source intact and the tenant left frozen.** Reopening the
  region they are leaving for writing would be worse than the stall.
- Refuses outright when the tenant exists in **more than one** region — that is a previous move whose
  purge failed, and picking a copy would destroy the other.
- Reports that an **Ask Paul vector database cannot travel**: it is a Supabase project, so that
  customer additionally needs a new project and a re-index before the move counts for GDPR.

**Deleting needs `DELETE` typed.** The old confirmation was a single click, in a table row where the
click before it was "toggle a module".

---

**0.4.2** (2026-09-10) — **one admin password per region.**

`TRACE_ADMIN_PASSWORD` stays the US instance's under its original name; `TRACE_ADMIN_PASSWORD_EU`
is the EU one. The two regional databases never travel together, so a single password covering both
would have meant one leak opening both regions' admin APIs — the same reasoning that gives them
separate `SESSION_ENC_KEY`s.

`traceRegions()` now counts a region as configured only when it has **both** a URL and its own
password, and `traceAdminPasswordFor()` has **no fallback** to the other region's. A wrong-region
call that happens to authenticate is far worse than one that fails.

**Found the hard way:** the EU app's `ADMIN_PASSWORD` could not simply be set to the US app's,
because a Fly secret is write-only and `vercel env pull` returns sensitive variables as empty. That
forced the per-region design — which was the better one anyway. It also surfaced that this repo's
local `.env.local` holds a **stale** `TRACE_ADMIN_PASSWORD` that does not match the live US
instance, so a local dev console cannot reach production traceability.

---

**0.4.1** (2026-09-09) — **the residency signpost, written to every region.**

Completes 0.4.0 against traceability-matrix 3.43.0, which added the `account_region` directory.

Each traceability instance holds only its own region's tenants, so an EU tenant has no
`account_access` row in the US database at all — and that instance told them *"contact us to open an
account"*, which is false and a dead end. `upsertRegionDirectory()` now writes a
`{account, region}` entry to **every** configured region on account creation (both the
no-database and the provisioning path), so whichever address a customer opens can redirect them.

- **The write is deliberately best-effort and never throws.** It is only sound because the directory
  **grants nothing** on the trace side — `account_access` is still the sole gate and a missing entry
  reads as "no idea", never as "here". So a region that missed the signpost costs that tenant a
  worse error message, never access to the wrong region's data. The regions that failed come back to
  the route, which reports them in a `warning` on an otherwise successful 201.
- An instance older than the endpoint answers 404; that is logged and skipped rather than reported,
  since it is version skew that resolves on the next deploy and the old behaviour is what it had.
- **The account editor now shows Data Region, read-only** (`SAFE_COLUMNS` gained `region`). Not a
  cosmetically-disabled field: `PATCH` refuses the value outright, so showing it as editable would
  imply an action that cannot happen.

---

**0.4.0** (2026-09-09) — **an account has a data region, and it is chosen once.**

GDPR residency means an EU customer's personal data must not rest in the US, and this platform
holds some of it in three places that share nothing: the tenant's own Supabase project, the
traceability instance's SQLite, and whatever endpoint its AI calls reach. `accounts.region`
(`sql/003_account_region.sql`, values `us` | `eu`, default `us`) is the single decision all three
follow.

What changed:

- **Create form** — a *Data Region* section above Modules, defaulting to United States. It is sent
  as `region` and validated strictly at the route: a present-but-unknown value is a 400, never
  coerced.
- **Provisioning** — the tenant's Supabase project is created in `supabaseRegionFor(region)` rather
  than the global `SUPABASE_PROJECT_REGION`. The region is persisted **inside the job payload**,
  because `tickSavingAccount` runs in a later request and writes the `accounts` row from the payload
  alone; a region held only in the starting function's arguments would have created the project in
  Frankfurt and recorded the account as US.
- **`lib/trace.ts` is now multi-instance** — `TRACE_API_URL` is the US app, `TRACE_API_URL_EU` the
  EU one. `listTraceAccounts()` fans out across configured regions and tags each row with where it
  came from; every write routes on that tag, so a save follows the row it was read from. The admin
  token cache is keyed by region. There is no fallback between regions anywhere, deliberately.
- **`PATCH /api/accounts/:id` refuses `region`** with a 400 instead of dropping it from the
  `PATCHABLE` allowlist silently.
- **An EU account cannot be created while `TRACE_API_URL_EU` is unset** — the allowlist row would
  have gone into the US SQLite while master recorded the account as EU.

Two things this release deliberately does **not** do, both still required before an EU customer can
actually be onboarded:

1. The EU Fly app does not exist yet — a second app in `fra` with its own volume and its own
   **EU-only** Litestream bucket. Tigris distributes objects globally by default, which would leak
   the WAL of an otherwise-compliant EU database.
2. AI calls are not yet region-routed. An EU tenant whose data rests in Frankfurt but whose
   panel-describe and quiz-generation calls reach the US Anthropic API is not compliant, and nothing
   in the UI shows the difference.

⚠️ **Every way this feature goes wrong is silent.** A tenant provisioned in the wrong region works
perfectly; one looked up in the wrong instance simply appears not to exist; a US LLM call for an EU
tenant returns a normal answer. That is why the region is immutable, why nothing falls back, and why
the mismatch check in `upsertTraceModules` refuses rather than picking a winner.

---

**0.3.5** (2026-09-05) — **the console was unusable on a phone**, and the CSS that was meant to
soften that was silently doing nothing.

**Why the earlier mobile CSS never fired.** `layout.tsx` had no viewport meta tag. Mobile Safari
and Chrome default to a 980px viewport when the tag is absent, so `@media (max-width: 860px)` was
false on every real phone and the rules underneath never applied. Now set via Next's `viewport`
export (`width: device-width, initial-scale: 1`, `maximum-scale` deliberately unset so users can
still zoom).

**Sidebar → off-canvas drawer** under 860px. A new sticky top bar carries a hamburger and a
compact brand; the sidebar itself is absolutely positioned, slid off-screen by default, and
translated in when the hamburger is tapped. A scrim behind it dismisses on tap, body scroll is
locked while it is open, and a `usePathname()` effect closes it when navigation happens (the
shell does not unmount on route change, so the drawer would otherwise stay open behind the new
page). Desktop markup is unchanged — the topbar, hamburger and scrim are all `display:none` above
the breakpoint.

**The rest of the mobile pass**, all in `globals.css`:

| Where | What |
|---|---|
| Page header | Stacks; the primary button spans the row at 12px vertical padding for a real tap target. |
| Search toolbar | Stacks; refresh becomes full-width. |
| Audit chip bar | Scrolls horizontally rather than wrapping into five rows. |
| Tables | Wrap in a horizontal scroller (`display:block; overflow-x:auto; white-space:nowrap`). Kept as tables rather than reflowed to cards so the QMS panel this mirrors stays easy to diff. |
| Modals | Full-screen (100dvh, no rounded corners, no overlay padding). Actions stack, buttons full-width. |
| Toast | Full-width strip at the bottom rather than pinned to the right corner where a thumb hides it. |
| Inputs | 16px font-size and 10-12px padding, on every input class. Below 16px iOS Safari zooms in on focus and the resulting layout shift is jarring. |
| Small pill buttons | Bumped from 4-10px to 8-12px. |
| Analytics totals | Stack rather than three narrow slivers across. |
| Login | Card is full-width with breathing room; primary and OAuth buttons at 12-14px padding. |

Nothing about the desktop layout changed — every rule is inside the 860px media query and there
are no changes to the underlying component markup other than the drawer wiring in `AppShell`.

Files: `src/app/layout.tsx`, `src/app/globals.css`, `src/components/AppShell.tsx`.

---

**0.3.4** (2026-09-02) — **the login screen's Orcanos URL box is displayed, disabled.** It was
free text from 0.2.7, which is what made the first successful Orcanos sign-in possible at all: the
platform account is `orcanosdemo` while the admin signing in belongs to tenant `orcanos`, and the
server's fallback order (request → the platform account's stored `orcanos_api_url` →
`ORCANOS_LOGIN_URL`) would otherwise have picked the wrong tenant. Nothing about that changes —
the value still comes from `/api/auth/config` (`ORCANOS_LOGIN_URL`) and is **still sent on the
request**, so the login runs against the server shown on screen. Only the typing is gone.

Two consequences worth recording:

- **`localStorage['orcanos_login_url']` is no longer read or written.** It used to win over the
  server default so a non-default tenant did not have to be retyped. With nothing to edit, a
  remembered value would pin a stale server on that browser permanently — the read had to go with
  the edit. The key is simply abandoned; nothing clears it.
- **The route is unchanged.** `orcanosUrl` is still client-supplied as far as
  `api/auth/local/login` is concerned, so `ORCANOS_LOGIN_HOST_ALLOWLIST` still applies to it and
  is still what carries the boundary the tenant pin used to (SECURITY.md §9.2). A disabled input
  is a UI fact, not a security one — anyone can still POST any URL.

The hint under the box was rewritten to match: it no longer offers "leave blank to use this
deployment's configured server", because that is now the only thing it can be.

---

**0.3.3** (2026-08-31) — **an account could exist in master and nowhere else, and this console had
no way to fix it.** Found on a live account (Traceability and Training both showing a dash, both
unclickable, no route back).

**What a dash means.** `account_access` on the traceability instance is what makes a tenant exist
there: it is read at login by `access_control`, and it carries all three module licences. A tenant
with no row reaches nothing and cannot sign in. The merged list renders that as `–` — *no answer
from this source*, deliberately not the same as an unticked box.

**The dead end.** `PUT /api/accounts/modules` answered **404** on a tenant with no row, and the
create form was the only thing in the app that could create one. So an account that missed it at
creation — an older create form, a trace write that failed after master was written, a row added
straight to master — could only be repaired on the traceability instance's own `/admin` page. From
here it was permanently three dashes.

Three changes, all of them about a row existing rather than what it holds:

| | Was | Now |
|---|---|---|
| Licensing Traceability or Training on a tenant with no entry | 404 | Creates the entry, licensed for that module only |
| Creating an account with no module ticked | No entry written at all | Entry always written, licensed for nothing |
| Licensing Ask Paul on a tenant with no entry | 404, no reason | 404 naming the fix: license Traceability or Training first |

**Ask Paul deliberately does not create the entry.** A new entry is licensed for nothing, and an
account that can sign in but reaches no module is exactly the state the "at least one module"
invariant exists to prevent — Ask Paul is a separate app and does not count as one. Licensing
either traceability-owned module creates the entry; Ask Paul then has something to attach to.

**A new entry starts licensed for nothing** (`newTraceAccountRow` in `lib/trace.ts`), and this is
the one non-obvious decision. An **absent** module column reads as *licensed* — `moduleFlag()`
matches `_modules_of`, fail-open, so a row written before 3.23.0 never silently loses a module it
already had. That is right for old rows and wrong as a default for new ones: a sparse new row would
license everything. So the three columns are written as an explicit `0`. Absence is a fail-open for
history, not a default for a row being created now.

`PUT /api/accounts/trace/:tenant` (the Traceability dialog) already created a missing row and still
does, from its own fail-open defaults — that dialog sends every flag explicitly, so its base only
supplies fallbacks for fields the payload omits. The two are cross-referenced in the code so the
difference reads as a decision.

**Adding a tenant to the allowlist grants sign-in**, which is more than the pill's label promises.
It is said before the click (the tooltip names it) and recorded after (`created_allowlist_entry` on
the `account_module_changed` audit event).

**Which tenant the licences are keyed on is now shown, and the guess is flagged as one.**
`account_access` is keyed on the Orcanos tenant; master `accounts` has no tenant column, so it is
derived from the tenant segment of `orcanos_api_url` — and when an account has no URL, the only
thing left to key on is the account name. That fallback was already there and was silent. It is
correct for every account since the 2026-08-29 rename and a guess for anyone whose label differs
from their virtual dir, so `traceTenantForAccount()` now returns *how* it decided: the create form
renders it under Modules (warning-styled when guessed) and the `account_created` audit event
records `tenant` and `tenant_from`.

The fallback was kept rather than removed. Refusing to guess would mean creating an account with no
allowlist row at all — which is the failure this whole release is about.

**An account with no Orcanos API URL still cannot have its modules set**, and that is unchanged and
correct: there is no tenant to key the licence on. The pill says so, and the fix is to set the URL
under *Edit → Orcanos REST API*. The real fix is an `accounts.orcanos_tenant` column instead of
parsing a URL — still not done, still flagged in `lib/modules.ts`.

**Found while deploying this release: `deploy.bat`'s build gate had never been running.** The file
was checked in with **LF line endings**, and `cmd.exe` mis-parses a multi-line `( … )` block in an
LF-only batch file — it executes fragments of the block's own lines as commands and skips the rest.
Steps 1–4 (dependencies, typecheck, production build) printed *nothing at all*; the script went
straight to the push prompt. Every `if errorlevel 1 ( … )` guard was part of the wreckage, so the
one thing the script exists to guarantee — that a red build cannot be pushed — was not happening.
It looked like it was working because the push prompt, the last thing on screen, still behaved.

All four batch files (`deploy.bat`, `run_dev.bat`, `open_login.bat`, and the launcher
`deploy.bat` one level up in `compliance-platform/`) are now CRLF, and a new `.gitattributes` pins
`*.bat` and `*.cmd` to `eol=crlf` so a clone cannot put it back. Re-run afterwards, the script
prints all five steps and the build actually gates.

Worth knowing when driving it non-interactively: `set /p` reads stdin, so redirected input is
consumed by the **commit message** prompt first when there is anything to commit, and only then by
the `DEPLOY` confirmation. Commit first, then feed it one line.

---

**0.3.2** (2026-08-31) — **two rules the console let an operator break.** Both were reported from
use of the 0.3.x create form.

**A duplicate account name is now refused before the form is filled in.** `POST /api/accounts` has
always answered 409 on one (case-insensitively, via `accountCiFilter`), but the browser only found
out after everything had been typed and the button pressed. The create dialog now takes the names
already on the merged list and checks as you type: the field goes red, the reason sits under it and
Create is disabled. The list is checked, not just master `accounts` — a name that collides with a
**traceability tenant** produces a row that merges into that tenant on the next load, which looks
like the new account silently taking over an existing one. The server check is unchanged and is
still the boundary; it is the only one that cannot race.

**Ask Paul cannot be licensed for an account with no database.** It is the only module with a
per-tenant vector store — Traceability and Training read from the traceability instance's own
SQLite — and licensing it without one produced a hand-off button into an app that has nowhere to
read from. Neither half of the licence (`accounts.is_active`, trace `allow_ask_paul`) can express
that: both look perfectly set, so nothing downstream reports it. Until 0.3.1 the create form
allowed the tick and printed a warning under it; the warning is now the rule.

The check is on all **four** places the licence can be turned on, and behind each of them:

| Surface | Behaviour | Route that enforces it |
|---|---|---|
| Create form | The Ask Paul tick is disabled unless *Provision a dedicated Supabase database* is ticked, and unticking the database clears it | `POST /api/accounts` → 400 |
| List pill | Disabled while the module is off and the account has no `vector_db_host`/`db_host` | `PUT /api/accounts/modules` → 409 |
| Traceability dialog | The Ask Paul checkbox is disabled while it is off and the linked master account has no database | `PUT /api/accounts/trace/:tenant` → 409 |
| Account editor — **Status** | The Active switch is disabled while the account is inactive and has no database | `PATCH /api/accounts/:id` → 409 |

**The fourth one is the one that is easy to miss, and it was still open after the first three were
closed.** The *Status* switch in the account editor writes `is_active`, which reads like an
account-level gate and is not one — it is read in exactly two places, both inside the QMS AI
backend, and traceability never reads it at all. 0.2.4 removed the Status *pill* for that reason and
folded `is_active` into the Ask Paul pill; the editor's switch was left behind, still labelled
"Status", still able to switch on half of the licence the other three surfaces now refuse.

It is checked against the row the PATCH **produces**, not the stored one, so entering the vector host
and flipping the switch in one save is allowed — that is how an account normally gets its database.
The dialog reads the same way: the switch unlocks as soon as a host is typed, before saving.

Consequently **an account created without a database is now created inactive**. Creating one active
would have switched on half of the licence `POST /api/accounts` refuses in the request above it.
Nothing outside Ask Paul notices: `is_active` gates the QMS AI account resolver and its pre-login
`validate_account`, and an account with no vector database cannot serve either.

**Turning it OFF is never blocked, anywhere.** An account whose database was removed still has to be
unlicensable, and an existing row whose `allow_ask_paul` column predates 3.27.0 reads as licensed
(`_modules_of` is fail-open) — blocking its save would have locked the dialog for every such
tenant. The server check therefore fires only on a transition to on, never on a row that already
holds the flag.

`has_database` is computed server-side in `mergeAccounts` from `vector_db_host || db_host`; only the
boolean crosses to the browser. `GET /api/accounts/trace/:tenant` gained `master_has_database` for
the same reason. `ASK_PAUL_NEEDS_DB` lives in `lib/modules.ts`, which reaches the service key, so
`TraceSettingsModal` carries a copy of the string rather than importing it.

**Found while wiring this up: the modules ticked on the create form were silently discarded whenever
a database was provisioned.** `POST /api/accounts` only wrote `account_access` on the no-database
path; the provisioning branch passed the payload to `startProvisioning()` and dropped `modules` on
the floor. Since Ask Paul can now *only* be ticked together with provisioning, that path had to work
before the rule above meant anything. The licences now ride on the job row and are written by
`tickSavingAccount` after the `accounts` row exists — deliberately at the end, because a job that
fails halfway must not leave a tenant licensed for a database that was never created. A failure
there is appended to the job's completion message instead of failing a job whose real work is done.

⚠️ Note what this composes to in production today: `running_schema` still cannot work from Vercel
(IPv4, see CLAUDE.md), so the provisioning path cannot complete — which means **Ask Paul cannot be
licensed at creation time at all**. The working sequence is: create the account without it, add the
vector DB under *Edit → Vector DB*, then license Ask Paul from its pill, which is exactly what the
new tooltips say to do.

**0.3.1** (2026-08-31) — **0.3.0 did not actually work.** Creating a no-database account was
rejected by PostgREST with `23502` — a not-null violation — so the feature failed on its first real
use, with an error naming no column at all (the UI showed the `details` payload, a bare tuple of
nulls, and truncated the `message` that would have said which one).

`accounts` inherits four **NOT NULL, no-default** columns from QMS: `db_type`, `db_name`,
`db_user`, `db_password_encrypted` — the legacy half of the vector-DB pair. The provisioning path
fills all four from the project it has just created, so nothing had ever inserted a row without
them, and the create form had never been able to reach this code before 0.3.0.

They are now written as **empty strings**. Deliberately not a schema change: `accounts` is shared
with the running QMS, and making the columns nullable needs QMS to agree that null is legal. Also
deliberately not a sentinel like `'none'`, which every reader would have to be taught. Empty string
already means "not configured" throughout this codebase — `orcanosTestLogin` returns
`{success: null}` on an empty secret, which the UI renders as a neutral note rather than a failure.
Making those columns nullable remains the cleaner fix if QMS ever agrees.

**Verified before shipping this time**, by inserting exactly the row shape the route builds against
the live `accounts` table (201) and deleting it again. Confirming that `tsc` and `next build` pass
says nothing about a database constraint, which is what 0.3.0 relied on.

Also recorded: the not-null set is now in `SCHEMA.md`, so the next person writing an `accounts`
row does not rediscover it from a 400.

**0.3.0** (2026-08-31) — **an account no longer needs a database to exist.** Creating one used to
always provision a dedicated Supabase project, which is the slowest and most failure-prone step in
the form — and is only needed by **Ask Paul**, the one module with a per-tenant vector database.
Traceability and Training read from the traceability instance and never needed it. The create form
now takes the module licences directly (they are written to `account_access`, where all three
already live) and provisioning is an opt-in checkbox, off by default.

The trigger was a real failure: creating `pcure` died at `running_schema` with
`getaddrinfo ENOTFOUND db.klrgfaddrnnawvagomxr.supabase.co`, **after** the billable Supabase
project had been created — an orphan. The retry then failed at creation, because the project name
was already taken.

That DNS error is structural, not transient, and worth stating plainly: `db.<ref>.supabase.co`
publishes **only an AAAA record** — Supabase dropped IPv4 for direct connections — and Vercel
functions are IPv4-only. **`running_schema` has therefore never been able to work from Vercel**,
which is consistent with provisioning never having completed end to end. The real fix is to dial
the pooler (`aws-0-<region>.pooler.supabase.com`, user `postgres.<ref>`), which does have A
records. That is *not* done; it is recorded in CLAUDE.md's provisioning section along with the
advice to write the `accounts` row **before** creating the project, so a failure is recoverable.

Server: `POST /api/accounts` now takes `provision` and `modules`. With `provision: false` it writes
the master row directly and returns `201 {account}` with no job at all. Licences are keyed on the
Orcanos **tenant** — parsed from `orcanos_api_url`, falling back to the account name — through the
new `upsertTraceModules()`, which creates the `account_access` row for a tenant that has none, and
only writes the flags it was given (an absent column reads as licensed, so writing 0 where the
operator said nothing would silently revoke a module). Master and the trace instance share no
transaction, so master is written first and a failed licence write returns 502 naming which half
landed — the same contract as the module pills.

**0.2.9** (2026-08-29) — **the running version is on screen, and release notes have a home.**
The sidebar footer shows `v<version>`; clicking it opens the release notes. Two new files back it:
`release_notes.json` at the repo root (the short, user-facing list the modal renders) and
`docs/changelog/CHANGELOG-v0.md` (this long-form history, moved out of CLAUDE.md). The version
itself comes from `package.json` via `lib/version.ts`, read server-side and passed into
`AppShell` as a prop — importing `package.json` from a `'use client'` file would ship the whole
dependency manifest to the browser.

Why the move: CLAUDE.md is loaded into every session and capped at 150,000 chars. Ten releases of
inline history were already a fifth of this file and are almost never the thing being asked about.
The rule from the `release-management` skill now applies here too — **short note in
`release_notes.json`, long note in `docs/changelog/`, and in CLAUDE.md only the current version
plus any trap that fails silently.**

**0.2.8** (2026-08-29) — **only Orcanos hosts are valid for sign-in.**
`ORCANOS_LOGIN_HOST_ALLOWLIST` now defaults to `orcanos.com` instead of shipping empty, which is
what makes 0.2.7's free-text URL box safe: the field still reaches any tenant, but the host is
ours, so `QW_Login`'s `Is_admin` is an assertion by a server we control again. Finding **B-1** in
[SECURITY.md §9.2](SECURITY.md) moves from accepted-risk to mitigated. Disabling it is spelled
`ORCANOS_LOGIN_HOST_ALLOWLIST=*` — deliberately not "unset", so it cannot come back by someone
clearing a Vercel field. A URL from `accounts.orcanos_api_url` or `ORCANOS_LOGIN_URL` is still not
filtered; that is where an on-prem customer on their own domain belongs.

Also fixed, in master, not in code: `users.id=1` (`zoharp@orcanos.com`) still had
`orcanos_user_name='rami.azulay'` — the test data this file warned about. Every password typed was
being checked as *Rami's*, which is the whole of the `Incorrect credentials` wall. Now
`zohar.peretz`. Orcanos also answers `"Incorrect credentials. Try Using SSO"` on that tenant, so if
password sign-in keeps failing with the right username, the account may be SSO-only and Google
sign-in is the path.

**0.2.7** (2026-08-29) — **the sign-in Orcanos URL is now a free-text field on the login screen,
and the tenant pin is gone with it.** Requested explicitly, with the consequence stated first and
the two safe alternatives declined: `POST /api/auth/local/login` takes `orcanosUrl` from the body,
so the same request-supplied string now decides both which server is asked and which `Virtual_dir`
that server is expected to report — `Is_admin` is an assertion by a host the caller chose, and
naming a staff row plus any password is enough. Recorded as accepted risk **B-1** in
[SECURITY.md §9.2](SECURITY.md), which contradicts the "⚠️ Requiring Orcanos `Is_admin` is safe
**only because the tenant is pinned**" note further down this file — §9.2 is now the accurate one.
`ORCANOS_LOGIN_HOST_ALLOWLIST=orcanos.com` reverses it completely at no operational cost and is the
recommended production setting; it ships empty because an unrestricted field was the ask. Also new:
`ORCANOS_LOGIN_URL` (default `app.orcanos.com/orcanos`) pre-fills the box and is a real fallback —
an empty `accounts.orcanos_api_url` used to be a 500. Login audit events now carry `orcanos_url`,
`virtual_dir` and `client_supplied_url`, which is the only way an attack is visible afterwards.

**0.2.6** (2026-08-29) — **Orcanos sign-in accepts the user name as well as the email, and the
password field has a show/hide toggle.** People know themselves by the Orcanos username they
already sign in with, not by the master `users.email` an admin typed. The first field now resolves
against either column (`findUserByEmailOrOrcanosUserName` in `lib/users.ts`) — email wins on a
double match, since the session is issued against it. This widens nothing: both columns are
admin-set, `QW_Login` is still called with the *stored* `orcanos_user_name` and never with what was
typed, and every gate after it is untouched. The username half is scoped to rows unlinked or
already bound to this tenant, so the lookup moved to after `expectedVirtualDir` is derived. The
request field is now `identifier` (`email` still accepted); the `no_such_user` audit detail
carries `identifier`. Case-insensitivity is done in code, not in the filter — PostgREST has no
case-insensitive equality and `ilike` would treat a `_` in a username as a wildcard.

**0.2.5** (2026-08-29) — **Microsoft sign-in withdrawn.** Closes finding A-1: the route defaulted
`office365_tenant` to `common`, verified no `tid`, and took the identity from Graph's `mail` — an
attribute an attacker sets freely in a tenant they own, which made the `@orcanos.com` half of the
platform gate the attacker's own assertion. Off in three places, because hiding a button is not a
control: `office365SignInEnabled()` in `lib/env.ts`, a 403 + audited `login_denied` at the top of
`api/auth/office365`, and the method no longer advertised by `api/auth/config`. The DB flag
`auth_methods.office365_enabled` is now tidy-up, not the control. **Google and Orcanos email
sign-in are untouched** — each method resolves independently. The vulnerable code is left in place
and unreachable so re-enabling forces a read of the finding first.

**0.2.4** (2026-08-29) — **the Status column is gone; the Ask Paul pill writes both halves.**
`accounts.is_active` was never a platform gate — only QMS AI reads it, so an account set Inactive
could still sign in to traceability (found by doing it). It is one half of Ask Paul's switch:
`is_active` kills the app, trace `allow_ask_paul` only hides the hand-off button. One pill now
writes both and ANDs them for display, so every column is one control per module. The two systems
share no transaction, so master is written first and a failed trace write returns non-2xx naming
which half landed; the list reloads after a failure too. Full record in
[INTERNAL_TRACE_MERGE.md](INTERNAL_TRACE_MERGE.md) §4.4.

**0.2.3** (2026-08-29) — **security audit + hardening.** Full review of the whole tree, recorded in
[SECURITY_AUDIT_2026-08-29.md](SECURITY_AUDIT_2026-08-29.md). Three fixes applied: `isSafeExternalUrl`
now resolves IPv4-mapped IPv6 spellings (`[::ffff:127.0.0.1]` normalises to `[::ffff:7f00:1]` and
walked straight past the dotted-quad check) and blocks CGNAT `100.64/10`; `next.config.mjs` sends
security headers, chiefly `frame-ancestors 'none'` — the console was framable and Delete account is
one click; and Google sign-in now requires `email_verified`, which is load-bearing because the email
domain is half the platform gate. **Three findings are still open and two need a decision** — read
[SECURITY.md §9.1](SECURITY.md). The highest, A-1, is that Office 365 sign-in defaults to tenant
`common` and takes its identity from Graph's `mail`, an attribute an attacker sets in their own
tenant; whether it is live depends on `office365_enabled`, which nobody has checked.

**0.2.2** (2026-08-29) — the Orcanos mark now appears on the sidebar brand and the login card.
`src/components/OrcanosLogo.tsx` is the same inline SVG traceability-matrix uses
(`src/frontend/src/App.jsx`) — arc on `currentColor`, dot on a new `--logo-dot` token. That dot is
`#f5821f`, deliberately not `--accent-orange` `#f5a623`: it belongs to the mark, so it matches the
other app rather than the palette.

**0.2.1** (2026-08-29) — the **QMS AI** module pill is now **Ask Paul**, and reads/writes the real
licence column `account_access.allow_ask_paul` instead of being derived from master `is_active`.
Ask Paul *is* the QMS AI app (`ask_paul_account` holds a tenant's master `account_name`), so the
licence column already existed and no master DDL was needed. Status and Modules now answer
different questions — account gate vs per-product licence — instead of being one value rendered
twice with the same PATCH behind both. Full record in [INTERNAL_TRACE_MERGE.md](INTERNAL_TRACE_MERGE.md)
§4.3. Also: `package.json` said `0.1.1` while this file said `0.2.0`; both now say `0.2.1`.

**0.2.0** (2026-08-28) — Orcanos-backed sign-in built. `POST /api/auth/local/login` now verifies
the password via `QW_Login` against the platform account's own Orcanos tenant instead of bcrypt
against `users.password_hash`. New migration `sql/002_orcanos_identity.sql`, applied to master
2026-08-29. Also fixed: the tenant pin no longer compares `Virtual_dir` against `PLATFORM_ACCOUNT`
directly (that's just the master-DB config-row label, e.g. `demo` — confirmed live to differ from
the real tenant segment, `orcanosdemo`); it now compares against the tenant segment parsed out of
that account's own `orcanos_api_url` (`lib/orcanos-url.ts` `orcanosVirtualDirFromUrl()`). Not yet
confirmed with an actual successful sign-in — see *Current state* below.

**0.1.1** (2026-08-28) — first live run against the master database. Google sign-in fixed and
verified; two never-applied migrations found.
