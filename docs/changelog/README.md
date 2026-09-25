# Changelog index — account-management

One line per release, newest first. The long form is
[`CHANGELOG-v0.md`](CHANGELOG-v0.md); the short, user-facing list the app's own release-notes
modal renders is [`release_notes.json`](../../release_notes.json).

`CLAUDE.md` deliberately carries **none** of this — only the current version and the traps. See
the `release-management` convention.

| Version | Date | Summary |
|---|---|---|
| `0.12.1` | 2026-09-25 | Non-admin Orcanos sign-in gets a clear 403 "Only Orcanos administrators can sign in" instead of "Invalid credentials". |
| `0.12.0` | 2026-09-25 | *Handbook* screen: the infrastructure deck served staff-only from `GET /api/handbook` and framed at `/handbook` (frame headers relaxed to same-origin for that one route). Handbook md + deck updated for everything shipped 09-10 → 09-25. |
| `0.11.0` | 2026-09-25 | Accounts list: per-row *Ask Paul ↗* and *Traceability ↗* links opening the product at the row's region (`APP_URLS` in `lib/regions.ts`). EU Ask Paul disabled — no deployment, no fallback to US. |
| `0.10.0` | 2026-09-24 | ISO 27001 screen: priority per open control (procedure = Low; security = Low–Critical by check and finding) and a recommendation per open check. Computed client-side from `check_ids` + evidence (`lib/iso27001-guidance.ts`); no migration. |
| `0.9.0` | 2026-09-16 | ISO 27001 screen: system selector (Ask Paul, Traceability), saved audit runs with per-run snapshots and change-vs-previous, ledger import, append-only answer history. `sql/006` applied 2026-09-16. `compliance-audit` skill moved into this repo. |
| `0.8.0` | 2026-09-16 | BOM module licence (`account_access.allow_bom`, traceability-matrix 3.46.0) — pill, Traceability-tab tick, create-form tick, overview state. Opt-in: absent reads as OFF, the inverse of every other module; writes refused on an instance without the column. |
| `0.7.0` | 2026-09-15 | New Disaster recovery screen — per-account Supabase PITR/backup status, read live from the Management API. Status only; no backup/restore pipeline exists yet to act on it. |
| `0.6.1` | 2026-09-10 | Account names are unique in the database (`lower(account_name)`, `sql/004` — **outstanding**), not only in the app's check-then-write; a create is refused while a job for that name is still provisioning; a job that loses the race fails with the orphaned Supabase project named. |
| `0.6.0` | 2026-09-10 | The account window re-cut into one tab per system — Overview, Orcanos, Traceability, Ask Paul, LLM, Spend. Ask Paul's licence, switch, database and delete are together at last; both AI configs and both spend ledgers are each on one tab; the region move and delete are collapsed. |
| `0.5.2` | 2026-09-10 | A region move streams its progress: the seven steps are shown before it is authorised and ticked off as the server passes them. NDJSON response — the verdict is the last line, not the HTTP status. |
| `0.5.1` | 2026-09-10 | The account window's tab strip no longer clipped by a tall tab body — the strip keeps its height and the body scrolls. |
| `0.5.0` | 2026-09-10 | One screen per account behind the account name; data region shown on the list with a conflict flag; move a customer between regions; delete needs `DELETE` typed. |
| `0.4.2` | 2026-09-10 | Each region's traceability instance has its own admin password (`TRACE_ADMIN_PASSWORD_EU`); a region counts as configured only with both a URL and its own password, and never falls back to the other's. |
| `0.4.1` | 2026-09-09 | The residency signpost is written to every region on account creation, so a customer opening the wrong region's address is redirected instead of told the account does not exist. Best-effort by design — it grants nothing. Data Region shown read-only in the editor. |
| `0.4.0` | 2026-09-09 | GDPR data residency: an account is created in a US or EU region, which decides where its Supabase project is provisioned and which of the two traceability instances holds it. Immutable after creation, and EU is refused until the EU instance exists. |
| `0.3.5` | 2026-09-05 | Mobile-friendly layout: hamburger drawer under 860px, stacked headers and toolbars, full-screen modals, horizontally scrolling tables, 16px inputs to stop iOS zoom-on-focus; the missing viewport meta added so the breakpoints actually fire on phones. |
| `0.3.4` | 2026-09-02 | The sign-in screen's Orcanos URL is shown disabled instead of typed; the remembered-server value is no longer read, so it cannot pin a stale server. |
| `0.3.3` | 2026-08-31 | A tenant with no traceability entry is no longer a dead end — the module pill creates one, and every new account gets one; the tenant a licence is keyed on is shown, and the guess flagged. |
| `0.3.2` | 2026-08-31 | Duplicate account names caught while typing; Ask Paul cannot be activated without a database on any of its four controls, and a database-less account starts inactive; modules ticked at creation no longer dropped by the provisioning path. |
| `0.3.1` | 2026-08-31 | Fixes 0.3.0: the no-database insert omitted four NOT NULL columns and was rejected outright. |
| `0.3.0` | 2026-08-31 | Accounts can be created without a database, licensing modules directly; provisioning is opt-in after it was found unable to work from Vercel at all. |
| `0.2.9` | 2026-08-29 | Version shown in the sidebar footer, opening release notes; history moved out of CLAUDE.md into this changelog. |
| `0.2.8` | 2026-08-29 | Sign-in URLs restricted to `orcanos.com` by default; the platform admin row's leftover test identity fixed. |
| `0.2.7` | 2026-08-29 | Free-text Orcanos URL on the login screen, `ORCANOS_LOGIN_URL` default, richer login audit detail. |
| `0.2.6` | 2026-08-29 | Sign in by Orcanos user name as well as email; show/hide password. |
| `0.2.5` | 2026-08-29 | Microsoft sign-in withdrawn in code (finding A-1). |
| `0.2.4` | 2026-08-29 | Status column removed; the Ask Paul pill writes both halves of the switch. |
| `0.2.3` | 2026-08-29 | Security audit and three fixes: SSRF spellings, security headers, `email_verified`. |
| `0.2.2` | 2026-08-29 | Orcanos mark on the sidebar brand and login card. |
| `0.2.1` | 2026-08-29 | QMS AI pill became Ask Paul and reads the real licence column. |
| `0.2.0` | 2026-08-28 | Orcanos-backed sign-in via `QW_Login`; tenant pin corrected. |
| `0.1.1` | 2026-08-28 | First live run against the master database; Google sign-in fixed. |
