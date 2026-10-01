# Changelog — account-management v1.x

Long-form release history. The short, user-facing list is
[`release_notes.json`](../../release_notes.json), which is what the app's release-notes modal
renders; the one-line index is [README.md](README.md). v0.x history is in
[`CHANGELOG-v0.md`](CHANGELOG-v0.md).

Newest first.

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
