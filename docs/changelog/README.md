# Changelog index — account-management

One line per release, newest first. The long form is
[`CHANGELOG-v0.md`](CHANGELOG-v0.md); the short, user-facing list the app's own release-notes
modal renders is [`release_notes.json`](../../release_notes.json).

`CLAUDE.md` deliberately carries **none** of this — only the current version and the traps. See
the `release-management` convention.

| Version | Date | Summary |
|---|---|---|
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
