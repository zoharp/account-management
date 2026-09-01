# Changelog — account-management v0.x

Long-form release history. The short, user-facing list is
[`release_notes.json`](../../release_notes.json), which is what the app's release-notes modal
renders; the one-line index is [README.md](README.md).

Newest first. Per the `release-management` convention, `CLAUDE.md` keeps only the current
version and any trap that fails silently — not this.

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
