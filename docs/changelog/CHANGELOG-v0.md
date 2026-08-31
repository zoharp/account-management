# Changelog — account-management v0.x

Long-form release history. The short, user-facing list is
[`release_notes.json`](../../release_notes.json), which is what the app's release-notes modal
renders; the one-line index is [README.md](README.md).

Newest first. Per the `release-management` convention, `CLAUDE.md` keeps only the current
version and any trap that fails silently — not this.

---

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
