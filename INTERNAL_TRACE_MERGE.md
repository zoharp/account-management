# Merged account list — what is done, what is missing — INTERNAL

> **Internal only. Not for GitBook, not for customers.** This records the state of merging the
> traceability-matrix `/admin` allowlist into the platform console, and every known gap.
>
> **Date:** 2026-08-29 · **Status:** built and typechecking, **not deployed, not verified end to end**

Companion docs: [`CLAUDE.md`](CLAUDE.md) · [`docs/platform/PLATFORM_AUTH.md`](docs/platform/PLATFORM_AUTH.md) ·
[`docs/platform/PLATFORM_MODULES_PROPOSAL.md`](docs/platform/PLATFORM_MODULES_PROPOSAL.md) ·
traceability-matrix `INTERNAL_ACCOUNT_ADMIN.md`

---

## 1. The decisions this was built on

Taken 2026-08-29. They are the reason the design looks the way it does.

| # | Decision |
|---|---|
| D1 | **Three modules:** QMS AI · Traceability · Training. |
| D2 | **Each module's licence lives where its runtime reads it.** No central table, no sync. QMS AI → master `accounts`; Traceability + Training → trace `account_access`. |
| D3 | **The union is over all accounts**, and master rows get created for the traceability-only tenants. |
| D4 | **Cost stays federated** — a read-side union of two ledgers, not a merged one. LLM setup stays per module. |
| D5 | **`ADMIN_PASSWORD` is reused** as the console's credential (`TRACE_ADMIN_PASSWORD`). |
| D6 | Deploy traceability-matrix **first**, then build the merge. *(Not honoured — the merge was built first; see §3.1.)* |

## 2. What exists now

One list, unioned on the Orcanos tenant, with a Modules column of three toggles, plus a
**Traceability…** dialog carrying every per-account setting the trace `/admin` page has:
access gates (sign-in, AI features, add-items/view-only), module licences, the Ask Paul licence
and name override, the per-tenant AI engine with a live key test, and that tenant's AI spend with
a call-level drill-down.

| File | |
|---|---|
| `src/lib/trace.ts` | Server-only client for the trace admin API |
| `src/lib/modules.ts` | The union and the merge key |
| `src/lib/module-catalog.ts` | The client-safe module list |
| `src/app/api/accounts/route.ts` | GET now merges |
| `src/app/api/accounts/modules/route.ts` | One-module toggle, fans out by owner |
| `src/app/api/accounts/trace/[tenant]/**` | Settings, AI config, key test, usage, delete |
| `src/components/TraceSettingsModal.tsx` | The dialog |
| `src/components/AccountsClient.tsx` | Merged list |

---

## 3. Blocking — cannot ship without these

### 3.1 traceability-matrix is seven releases behind on Fly

**Fly runs 3.21.0. Local is 3.28.0.** Production's admin API has no `allow_trace`,
`allow_training`, `allow_ask_paul` or `ask_paul_account`.

Consequences today:

- Module toggles are **disabled** against Fly, with the reason in the tooltip. The API refuses
  the write too — that endpoint rewrites the whole row from a pydantic model and ignores unknown
  fields, so a write would answer `{"ok": true}` and silently discard the flag.
- The Ask Paul name override cannot be set from the console against production.
- So against Fly the console is, in practice, **read-only for modules** and can still edit
  sign-in / AI / add-items.

**Unresolved sub-decision, asked twice, still open:** `allow_training` backfills existing rows to
`1` and `_modules_of()` fails open, so the moment that image boots **all 15 production accounts
are licensed for Training** and get the Portal and the (unshipped) quiz module. The columns do
not exist until that same deploy runs the migration, so they cannot be pre-set.

Options, recommendation unchanged:

1. Deploy, then immediately set flags via the API (exposure window = the deploy).
2. **Change the `ALTER` for `allow_training` to `DEFAULT 0` before deploying.** No exposure
   window. Inverts the documented fail-open convention, so it needs a comment saying why.
3. Hold the deploy until the Training module is ready to ship.

Note the tree also carries an entire unshipped Training Management module (`quiz_api.py`,
`quiz_engine.py`, `QuizBuilder.jsx`, `TakeQuiz.jsx`, `MyTraining.jsx`) wired into `app.py`.
Deploying ships that too.

### 3.2 ~~`TRACE_ADMIN_PASSWORD` is not in Vercel~~ — **resolved 2026-08-30**

Both halves are now set in Vercel Production, and the banner is gone. Two things this cost, worth
keeping:

- **`TRACE_API_URL` was set, but to `http://127.0.0.1:8010`** — the local dev value. A wrong value
  is worse than a missing one: `traceApiUrl()` uses `required()`, so an *unset* variable fails
  loudly at the named variable, while a laptop address fails as a generic `fetch failed` from a
  datacenter. Read the banner's URL before assuming anything.
- **The two must move together.** Fixing only the URL turned `fetch failed` into
  *"TRACE_ADMIN_PASSWORD was rejected by the traceability API"*, which reads like a new bug rather
  than the second half of the same one. The Fly `ADMIN_PASSWORD` was then rotated (`fly secrets
  set`, which restarts the machine and invalidates every issued admin token) and Vercel set to
  match.

And the trap underneath both: **a Vercel env change does nothing until something redeploys.** See
[DEPLOYMENT.md](DEPLOYMENT.md) → *An environment change is not live until something redeploys*.

### 3.3 ~~Nothing has been verified end to end~~ — **mostly resolved 2026-08-30**

Now verified in production:

- ✅ **The merged list renders against Fly.** A Vercel function does reach
  `traceability-matrix.fly.dev` — that was the open unknown, and it is closed.
- ✅ `npx next build`, and every deploy since has run it before pushing.
- ✅ The trace login → `X-Admin-Token` → `/api/admin/accounts` path, including the 401-retry in
  `lib/trace.ts` (exercised for real by the password rotation above).

Still **not** verified:

- Any **write** from the console to Fly — the module pills, the AI config save.
- The AI key test and the usage drill-down against any instance.

---

## 4. Decided but not built

### 4.1 `accounts.orcanos_tenant` — the merge key is currently derived

The union keys on the Orcanos tenant, and on the master side that is **parsed out of
`orcanos_api_url`** by `tenantOf()` at read time. It works for all three live accounts, but:

- a master account with no `orcanos_api_url` **cannot be matched at all** and shows a blank
  traceability half with no way to fix it from the UI;
- the key silently changes if someone edits the API URL;
- there is no uniqueness constraint, so two accounts could resolve to one tenant.

**Wanted:** `alter table accounts add column orcanos_tenant text;` unique on `lower(...)`,
backfilled from `orcanos_api_url`, and set explicitly on create. Then `tenantOf()` reads the
column and falls back to parsing.

**Half of the first bullet was fixed in 0.3.3 — the other half is still true.** The half that was
never a data problem at all was that the *console* had no way to add a missing `account_access`
row: the module pill answered 404 on a tenant it could not find, and only the create form could
create one. So an account that missed it at creation was three dashes for ever, repairable only on
the trace instance's own `/admin` page. Now the pill creates the row (Traceability or Training
only — never Ask Paul, which would produce a tenant that can sign in and reach nothing), and every
account creation writes the row whether or not a module was ticked.

What that does **not** fix is a master account with **no `orcanos_api_url`**: there is still no
tenant to key the row on, so its pills stay disabled and the only fix is to set the URL. And when
an account is created without one, the licences are keyed on the **account name** as a fallback —
now surfaced rather than silent (`traceTenantForAccount()`, shown in the create form, recorded as
`tenant_from` on the audit event), but still a guess. The column above remains the actual fix.

### 4.2 The 12 traceability-only accounts have no master row

D3 says create them. Not done — the console renders them read-side with a **Trace only** badge.
Until they exist in master they have no `account_name` and no billing. Since §4.3 they *can* be
licensed for every module, Ask Paul included — those licences live in `account_access`, which is
exactly where a trace-only tenant does exist.

Checked, for when this is done: QMS `/admin/accounts` lists rows unfiltered, so its Accounts panel
will show 15 instead of 3, twelve with no `db_type`. Nothing else touches them — routing is via
`X-Account` against a `users`/`auth_methods` match and no users exist for those tenants. Cosmetic
only.

Tenants involved: `abramscientific`, `deroyal`, `drlanger`, `nvision`, `prashant`, `qbridgesb`,
`rakesh`, `realviewimaging`, `seeallai`, `shirfrank`, `supira`, `zimmer`.

### 4.3 ~~QMS AI licensing is derived from `is_active`~~ — **resolved 2026-08-29**

The derivation is gone, and it needed no master DDL after all.

Was: `modules.qms_ai` = `master row exists && is_active`, and the QMS AI toggle wrote `is_active` —
the same write as the Status pill. Two different acts (deactivating an account, unlicensing one
product) behind one column, rendered twice in the same row.

The fix was noticing that **Ask Paul *is* the QMS AI app** — `ask_paul_account` on the trace side
holds what a tenant is called inside it, i.e. its master `accounts.account_name` (the trace tenant
`orca60` was "Medical Portal" there — until the 2026-08-29 rename made both `orca60`, §6.1). So the
licence column already existed: `account_access.allow_ask_paul`,
added in traceability-matrix 3.27.0. The pill is now labelled **Ask Paul** and reads and writes that.

The column now means one thing each, matching the split `access_control.check_account()` already
makes:

| Column | Source | Question |
|---|---|---|
| ~~Status~~ | master `is_active` | Removed in §4.4 — folded into the Ask Paul pill, which writes it. |
| Modules | `allow_ask_paul` / `allow_trace` / `allow_training` | which products it is licensed for |

Consequences worth knowing:

- **All three modules now come from one source.** Master has no module column and needs none.
- **`supportsAskPaul()` is checked separately from `supportsModules()`.** `allow_ask_paul` landed
  in 3.27.0, four releases after `allow_trace`/`allow_training` (3.23.0), so an instance on
  3.23–3.26 writes those two fine and would silently discard an Ask Paul flag. `TraceSourceStatus`
  carries both flags and the toggle is disabled with its own message.
- **The "last module off" invariant excludes Ask Paul.** It is a separate app reached by SSO
  handoff, so unlicensing it strands nobody inside traceability, and holding it alone is not a
  module anyone can sign in to.
- **Two surfaces now write `allow_ask_paul`** — the Modules pill and the existing Ask Paul section
  in `TraceSettingsModal`. Both go through `saveTraceAccount`'s merge, so they agree.
- **Fly is still 3.21.0 (§3.1).** Against production the Ask Paul pill shows fail-open licensed and
  is not clickable until that deploy lands.
- ⚠️ **This pill is one of three gates, and the other two are invisible from here (2026-08-30).**
  What a user actually sees is `ask_paul_enabled`, an AND of: this licence column (fail-open), the
  user's Orcanos `O` permission letter (fail-open), and the traceability *deployment* having
  `ASK_PAUL_SSO_SECRET` + `ASK_PAUL_APP_URL` set (**fail-closed**). Only the third hides the
  button, and this console cannot see it — so the pill reads *licensed* while nobody, in any
  tenant, can use it. That is exactly what happened on 2026-08-30: neither var was ever set on
  Fly. Diagnose with the trace API's `/api/admin/info`, which returns
  `ask_paul.configured` / `.url` / `.secret_present` for this purpose.
- ⚠️ **And configuring the trace side only makes the button *appear*.** The far side — Ask Paul's
  own Cloud Run service — needs the byte-identical `ASK_PAUL_SSO_SECRET`, or the click lands on
  *"SSO is not configured for this deployment"*. It had never been in Ask Paul's `cloudbuild.yaml`
  at all; added 2026-08-30. Four settings across three clouds, and a licence tick here is one of
  them. Full table in traceability-matrix's `INTERNAL_ACCOUNT_ADMIN.md`.

### 4.4 ~~There is no platform-wide account gate — and "Status" implies there is~~ — **resolved 2026-08-29**

Found 2026-08-29 by setting an account Inactive and then signing in to traceability anyway.
That is the code behaving correctly; the **column name is the bug**.

`accounts.is_active` is read in exactly two places, both in the QMS AI backend — the per-request
account resolver (`api.py:240`, `403 "Account is inactive"`) and the pre-login `validate_account`
(`api.py:307`). **Nothing else in any of the five projects reads it**; `is_active` does not appear
anywhere in `traceability-matrix/src/backend`. So Status means *"QMS AI: on/off"*, sitting in a
column called Status next to a Modules column — which is exactly why it read as duplicating the
old QMS AI pill.

Four independent switches, no gate above them:

| Flag | Where | Turns off |
|---|---|---|
| `is_active` ← **Status** | master | QMS AI / Ask Paul, every request + pre-login |
| `allow_access` | trace | traceability sign-in |
| `allow_ask_paul` | trace | the trace → Ask Paul handoff button only |
| `allow_trace` / `allow_training` | trace | individual panels |

Note `is_active` and `allow_ask_paul` are related but **not** duplicates: `is_active` switches the
app off server-side for everyone, `allow_ask_paul` only hides the door in from traceability.

**Resolved — the Status column is gone.** Neither of the two options first drafted here (make
Status write `allow_access` too; or rename it to a fourth pill) was taken. The operator's framing
was better than both: *if it is off, close it on master **and** hide it in traceability — one
button per module.*

So **the Ask Paul pill owns both halves and writes both**:

| Click | Writes | Effect |
|---|---|---|
| Ask Paul off | master `is_active = false` | the app 403s every request — it is dead |
| | trace `allow_ask_paul = 0` | the hand-off button disappears from traceability |

The pill **ANDs** the two for display: off in either place means a user does not get Ask Paul, so
showing it as licensed would over-report. `is_active` is no longer surfaced as a gate of its own —
it is Ask Paul's half of one switch, which is all it ever was.

Consequences:

- **Every column is now one control per module.** No pill duplicates another, and nothing in the
  console claims an account-level gate that does not exist.
- **Half-writes are normal and are said up front.** 12 of 15 accounts are trace-only (no master
  row) and can only move the hand-off half; a master row absent from the allowlist can only move
  the app half. The toggle stays clickable when *either* half is writable, and the tooltip names
  what will change (`scopeNote()`).
- **There is no shared transaction across the two systems.** Master is written first (it is the
  real kill switch); if the trace write then fails, the response is non-2xx and names exactly which
  half landed — *"…but the traceability hand-off was NOT changed: …. The two are now out of step."*
  The audit event is logged with `success: false` and the halves that were written.
- **The list reloads after a failed toggle too**, not only a successful one — a rejected call may
  still have moved one half, so the sources are the only trustworthy answer.
- **`is_active` is still editable** in the account detail modal, which is the right place for it.
- **`allow_access` is untouched by this.** Traceability sign-in is still governed only by
  `allow_access`, editable in the Traceability… dialog. That is a traceability control, not a
  platform gate, and it is no longer implied to be one.

---

## 5. Known gaps in what was built

| # | Gap | Impact |
|---|---|---|
| G1 | **No "remove from allowlist" button.** `DELETE /api/accounts/trace/:tenant` exists and returns the sign-out warning, but nothing in the dialog calls it. | Deleting a tenant still needs the old `/admin` page. |
| G2 | **The Spend link opens the QMS-only billing modal** while the list shows *combined* QMS + traceability spend. The trace half is only reachable through the Traceability… dialog. | The number in the list and the number in the modal disagree, with no explanation on screen. |
| G3 | **The global default AI engine (the reserved `*` row) is not surfaced.** It is account-independent, so it needs a settings page rather than a per-account dialog. | Still only editable on the trace `/admin` page. |
| G4 | **`ask_paul_account` is not populated.** The dialog now detects and offers to fix a mismatch, but nobody has walked the accounts. **Narrowed 2026-08-29:** the two accounts that diverged were renamed (§6.1), so all three master names now equal their tenant and there is no mismatch left to reconcile — but the column itself is still empty on the trace side. | A wrong value fails at hand-off time, not at save time. An empty one still does. |
| G5 | **No tests.** No unit test on `mergeAccounts()`, no route test, nothing in `TESTING.md` yet. `mergeAccounts` is pure and takes two arrays — it is the obvious first test. | |
| G6 | **The list refetches after every toggle** rather than updating in place. Correct (a trace save is a read-modify-write of the whole row, so the authoritative state is whatever it now says) but chatty. | Fine at 15 accounts. |
| G7 | ~~`security_audit_log` missing from master.~~ **Resolved 2026-08-29** — the table was confirmed absent (PGRST205) and created via the Management API, along with `account_provisioning`. Audit coverage was then extended to credential *use* (four `*_tested` events) and the page gained group filters. Full write-up: [SECURITY.md §8](SECURITY.md#8-audit-trail). | The trail starts **empty**: nothing either app produced before 2026-08-29 was ever recorded, and none of it is recoverable. An empty period before that date means "nothing was being recorded", not "nothing happened" — say so in any evidence pack. |

---

## 6. Risks and things to be aware of

### 6.1 `account_name` was renamed to the tenant (2026-08-29)

This section used to say **do not do this**. It was done anyway, deliberately and at the user's
request: `demo` → `orcanosdemo` and `Medical Portal` → `orca60`, so master `account_name` and the
Orcanos tenant segment are now the same string for all three accounts. The full record, with the
SQL, is in [CLAUDE.md](CLAUDE.md) → *Current state*.

The objection was that in QMS AI that string is a routing key, in three places:

| Where | What the rename did |
|---|---|
| **`account_llm_keys`**, keyed on it as a string with no FK | **Handled.** Updated in the same transaction, so no key was orphaned. Same for `auth_methods` (1 row each) and `account_usage_logs` (393 + 3 rows, so spend history stays attributed). |
| The **`X-Account` header**, read from the browser's `localStorage` | **Not handled — cannot be.** Every live QMS session still sends the old name. Those users must re-select the account; a stale `localStorage` value now names an account that does not exist. |
| The **`?account=` query param** on shared links | **Not handled — cannot be.** Any saved or circulated link carrying `?account=demo` or `?account=Medical%20Portal` is now dead. |

So the two client-side consequences are real and outstanding. They are recoverable by re-selecting
the account; nothing is lost, but nobody was warned before it happened.

What this does *not* change: the mapping is still carried explicitly on both sides —
`ask_paul_account` on the trace side, `orcanos_tenant` (§4.1) on the master side. Those columns are
not now redundant. They exist because the two strings are allowed to differ, and a future account
may well be created where they do again.

### 6.2 The trace API has no PATCH — saves must merge

`POST /api/admin/accounts` rewrites the whole row from a pydantic model, so **any field the
caller omits reverts to that model's default.** This already bit once: 3.27.0 added
`allow_ask_paul` (default `1`) and `ask_paul_account` (default `''`) after the console's save
path was written, and the console would have re-licensed Ask Paul and wiped the name override on
every unrelated save.

`saveTraceAccount(current, changes)` now merges over **the row as it came back from the API**, so
a column added on the trace side survives without a change here. Keep it that way — do not
reintroduce an explicit field list.

### 6.3 Local dev writes to production master

There is one master Supabase and `.env.local` points at it. So in local dev the merged screen is
production QMS AI data joined against a local SQLite. Traceability toggles are safe (local file);
**the QMS AI toggle, the Status pill, account edits and the audit writes all hit production from
a laptop.** A second Supabase project for dev is the real fix and is out of scope.

### 6.4 Trace API keys are stored in plaintext

`ai_config.api_key` is a plain `TEXT` column in the SQLite on the Fly volume, replicated by
Litestream. The master equivalent (`account_llm_keys.api_key_encrypted`) is AES-256-GCM. The
asymmetry is more visible now that both render on one screen. ISO 27001:2022 A.8.24. Not
introduced by this work; should get an issue.

### 6.5 Dev ports — 8010 is traceability, 8000 is QMS

| Project | backend | frontend |
|---|---|---|
| Orcanos QMS (`run.bat`) | **8000** | 5173 |
| quiz-management | — | 3000 |
| traceability-matrix (`run_dev.bat`) | **8010** | 3010 |
| account-management (`run_dev.bat`) | — | 3100 |

traceability-matrix moved to 8010/3010 on 2026-08-29 precisely so it stops colliding with QMS,
and its `run_dev.bat` now kills only the PIDs holding *its own* ports rather than every
`python.exe`. So all three stacks can run at once.

**`TRACE_API_URL` must be `http://127.0.0.1:8010`.** Pointing it at 8000 reaches the *QMS*
backend, which has no `/api/admin/*` — the console then shows
`Traceability admin login failed (HTTP 404)` and the traceability half of the list goes blank.
That 404 is the signature of this mistake; a connection refused means nothing is listening at all.

### 6.6 Cost is two ledgers, permanently

By D4. `ai_usage` (SQLite, keyed by tenant, lifetime totals) and `account_usage_logs` (master,
keyed by uuid, page totals in the modal). The list adds them; nothing reconciles them. If
one-place reporting is ever needed, the deferred option was a nightly roll-up of the trace totals
into master — a sync job that can drift, which is why it was not taken.

---

## 7. Suggested order

1. Settle §3.1 (the `allow_training` backfill), deploy traceability-matrix. **Now also gates the
   Ask Paul pill** (§4.3) — Fly's 3.21.0 has neither `allow_trace` nor `allow_ask_paul`.
2. Set `TRACE_ADMIN_PASSWORD` in Vercel; confirm the merged list renders against Fly.
3. Walk the three accounts and fix `ask_paul_account` (G4).
4. Add `accounts.orcanos_tenant` (§4.1) — smallest change with the largest correctness payoff.
5. Create the 12 master rows (§4.2).
6. ~~Retire the derived QMS AI licence (§4.3).~~ **Done 2026-08-29** — no master DDL needed.
7. Close G1, G2, G3; add the `mergeAccounts()` test (G5).
