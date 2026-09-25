# account-management — Disaster Recovery & Business Continuity

The recovery plan for the Orcanos platform control plane and the data stores it governs:
what exists, how it is backed up **today** (verified, not intended), how to recover from each
failure, how to prove the procedure works, and what is still missing.

ISO 27001:2022 A.5.29, A.5.30, A.8.13, A.8.14. Mapping in [ISO27001.md](ISO27001.md).

Related:
- `Orcanos QMS/design/BACKUP_RECOVERY_PLAN.md` — the QMS-side plan (logical dumps to GCS,
  migration replay). This file is the platform-wide runbook and supersedes it for the master
  project; that one stays authoritative for the QMS per-tenant schema checklist.
- traceability-matrix `litestream.yml`, `docker-entrypoint.sh` — the SQLite replication design
- [DEPLOYMENT.md §8](../../DEPLOYMENT.md#8-rollback) — application rollback
- [SCHEMA.md §2](../../SCHEMA.md) — `accounts.region`, and why it is immutable

> **Status: plan written, nothing rehearsed.** No restore of any store below has ever been
> performed. Until §8 has a first entry, every RTO in this file is an estimate.

---

## 1. Principles

1. **Master first.** The master project gates sign-in for every app and holds every tenant's
   encrypted credentials. No tenant recovery is possible until master is back.
2. **A backup without the key is not a backup.** Tenant credentials in master are AES-256-GCM
   under `ENCRYPTION_KEY`. Restoring master without that exact key yields a database of
   undecryptable ciphertext (§6.3).
3. **Never restore across regions silently.** An EU tenant restored into a US project is a GDPR
   breach that produces no error anywhere. A region change during recovery is a compliance
   decision, recorded, not an engineering shortcut.
4. **Restores are destructive and human-triggered.** Nothing restores automatically; a named
   person authorises, a second person verifies (§7).
5. **Drill on scratch, never in place.** Rehearsals restore into a new project/app, never over
   production.

---

## 2. Asset inventory

Verified 2026-09-16 with the Supabase Management API and `fly`.

### 2.1 Stores we own

| Store | What it holds | Where | Criticality |
|---|---|---|---|
| **Master Supabase** `accounts-master` (`jjiavhexvfahboiodomv`) | `accounts` + 5 encrypted credential columns, `users`, `auth_methods`, `account_llm_keys`, `account_usage_logs`, `security_audit_log`, `account_provisioning`, `iso27001_controls` | us-east-1 | **Tier 0** — every app's sign-in and every tenant's connection details |
| Tenant Supabase `askpaul-orcanos` (`bebncugzaejmnradewfu`) | Ask Paul documents, chunks, embeddings, conversations for **Orcanos** | us-east-1 | Tier 1 |
| Tenant Supabase `askpaul-orcanosdemo` (`vfbatsmdlusqhbevtylk`) | same, **orcanosdemo** | us-east-1 | Tier 2 (demo) |
| Tenant Supabase `askpaul-orca60` (`eoxpzwmowzbrwpufpzir`) | same, **orca60** — account region `eu` | **us-east-1** ⚠️ §3.3 | Tier 1 |
| Traceability US — Fly `traceability-matrix`, volume `vol_r68z8lo0y62gjxn4` | SQLite: `account_access` (module licences), every US tenant's panels | `iad`, 5 GB, encrypted | **Tier 1** — no row means the tenant cannot sign in to traceability |
| Traceability EU — Fly `traceability-matrix-eu`, volume `vol_4919qpz9m39mx59r` | SQLite, EU tenants | `fra`, 1 GB, encrypted | Tier 1 |
| Litestream buckets (Tigris) `traceability-matrix-db`, `traceability-matrix-eu-db` | Continuous WAL replica of each SQLite file | Tigris (global by default — EU restriction **unverified**) | Is the backup |

`meesh` has no database of its own (`vector_db_host` null) — nothing to back up beyond its master
row and its traceability row.

### 2.2 Stores we do not own

| Store | Owner | Our responsibility |
|---|---|---|
| Customer Orcanos SQL Server / Orcanos REST | Orcanos / customer | None for its data. We hold only its encrypted connection credentials (in master) |
| Google OAuth clients | Google Cloud project | Client IDs/secrets are in master `auth_methods`; redirect URIs documented in DEPLOYMENT.md §4 |

### 2.3 Stateless — rebuilt, not restored

| Component | Rebuilt from |
|---|---|
| account-management app (Vercel) | `zoharp/account-management` `main` + Vercel env vars |
| Traceability app image | traceability-matrix repo, `fly deploy` (`fly.toml` / `fly.eu.toml`) |
| Tenant schema reference data | `sql/bootstrap_new_account.sql` |

### 2.4 Secrets that cannot be regenerated

These are the real single points of failure. Everything else can be re-created or re-issued.

| Secret | Lives in | If lost |
|---|---|---|
| **`ENCRYPTION_KEY`** | Vercel (this app) **and** QMS Cloud Run — must be identical | Every `*_encrypted` column in master is permanently unreadable. Each tenant's DB password, service-role key, Orcanos password and LLM key must be re-obtained and re-entered by hand |
| `JWT_SECRET` | Vercel + QMS | Regenerable — every session in both apps ends; everyone signs in again. Must change in both at once |
| `TRACE_ADMIN_PASSWORD(_EU)` = trace `ADMIN_PASSWORD` | Vercel + Fly secrets | Regenerable — set both sides together |
| `SUPABASE_ORG_ACCESS_TOKEN` | Vercel | Regenerable from the Supabase dashboard |
| Tigris access keys | Fly secrets (set by `fly storage create`) | Regenerable, but a restore needs them — re-issue before §5.5 |

---

## 3. Current backup posture (verified 2026-09-16)

### 3.1 Supabase

From `GET /v1/projects/{ref}/database/backups` for all four projects:

| Project | `pitr_enabled` | `walg_enabled` | Daily physical backup | Last completed |
|---|---|---|---|---|
| accounts-master | **false** | true | yes, unbroken daily | 2026-09-16 08:08 UTC |
| askpaul-orcanos | **false** | true | yes | 2026-09-16 06:14 UTC |
| askpaul-orcanosdemo | **false** | true | yes | 2026-09-16 11:40 UTC |
| askpaul-orca60 | **false** | true | yes | 2026-09-16 06:26 UTC |

**Meaning:** every project can be restored to a **daily snapshot boundary** only. Worst-case data
loss is ~24 h. Snapshot retention is set by the Supabase plan (7 days on Pro) and has not been
confirmed per project. Physical backups restore **in place, into the same project** — they are not
downloadable and do not survive the project being deleted.

The Disaster recovery screen correctly shows all four as **At risk** (PITR off).

### 3.2 Traceability (Fly)

| Layer | US | EU |
|---|---|---|
| Litestream → Tigris | `BUCKET_NAME` set, continuous, snapshot every 6 h, **72 h retention** | same config, separate bucket |
| Fly volume snapshots | daily, **5-day retention** (2 listed on 2026-09-16) | daily, 5-day retention |
| Auto-restore on empty volume | yes (`docker-entrypoint.sh`) | yes |

**Meaning:** RPO of seconds while the machine runs. Litestream only replicates from a running
process — writes during a crash window after the last shipped frame are lost. Neither history
reaches beyond 5 days.

### 3.3 Finding: orca60 is eu in master, its database is in the US

`accounts.region = 'eu'` for **orca60**, but its Supabase project `askpaul-orca60` is in
**us-east-1**. `CLAUDE.md` recorded all four accounts as `us` on 2026-09-10, so the account was
moved to EU after that — the region move covers the traceability row, **not** the Supabase project.

Consequences:
- If the customer's Ask Paul content includes EU personal data, it is resting in the US today.
- A recovery that "follows the region" would provision an EU project and restore US data into it —
  an undocumented cross-border transfer in the other direction.

Not changed by this document. Needs a decision: migrate the project to `eu-central-1`, or record
why the Ask Paul store is out of residency scope for this customer.

### 3.4 What is not backed up at all

| Gap | Impact |
|---|---|
| No off-platform copy of **any** Supabase project | Deleted project, compromised org token or Supabase account loss = unrecoverable |
| No history beyond ~7 days (Supabase) / 5 days (Fly) | A corruption noticed on day 8 cannot be undone |
| No escrow record for `ENCRYPTION_KEY` | §2.4 |
| Vercel env vars exist only in Vercel | Rebuilding the project means re-assembling every value by hand |
| `security_audit_log` has no export | A.8.15 evidence lives only in the store it describes |

---

## 4. Targets

### 4.1 Current (measured from §3, not from a drill)

| Tier | Store | RPO today | RTO today (estimate, unrehearsed) |
|---|---|---|---|
| 0 | Master | ≤ 24 h | 1–4 h (dashboard restore + verification) |
| 1 | Tenant Supabase | ≤ 24 h | 1–4 h per project |
| 1 | Traceability | seconds (while running) | 15–60 min (`litestream restore` on a new volume) |
| — | App (Vercel) | n/a | minutes (redeploy / instant rollback) |

### 4.2 Proposed

**Not agreed.** No customer contract or SLA defining RPO/RTO was found. These are proposals for the
owner to accept or change; until accepted, §4.1 is the honest statement.

| Tier | RPO | RTO | What it takes |
|---|---|---|---|
| 0 Master | 5 min | 2 h | PITR on master (Supabase add-on, per project) |
| 1 Tenant / Traceability | 1 h | 8 h | PITR or nightly logical dump; Litestream already meets it |
| 2 Demo | 24 h | 2 business days | Nothing — met today |

---

## 5. Recovery runbooks

Each runbook: **declare → authorise → recover → verify (§7) → record (§8)**. Write the start time
before step 1; it is the measured RTO.

### 5.1 Application outage or bad deploy (Vercel)

Symptom: accounts.orcanos.ai errors, blank, or a release broke something. Data is untouched.

1. Vercel → project → Deployments → last good deployment → **Promote to Production** (instant).
2. If an env var was the cause: fix it, then **redeploy** — an env change alone does nothing
   (CLAUDE.md #9).
3. Revert the offending commit locally; a push is a deploy and needs approval.
4. Verify: §7.1.

If Vercel itself is down: nothing to do for the control plane. Customer apps (QMS, traceability) do
not depend on it at runtime — only staff administration is unavailable. Wait it out.

### 5.2 Master data corruption, bad migration or accidental delete

1. **Freeze writes.** Tell staff to stop using both this app and the QMS Accounts panel. Note the
   last known-good time from `security_audit_log` (the offending `account_updated` / migration).
2. Authorise (§6.1). A restore replaces **all** of master, including sign-ins and audit rows written
   since the backup — export anything needed first:
   `select * from security_audit_log where created_at > '<backup time>'` via the Management API.
3. Supabase dashboard → `accounts-master` → Database → Backups → pick the daily backup **before**
   the incident → Restore. The project is unavailable during the restore; every app's sign-in fails.
4. Re-apply any `sql/00N_*.sql` migration run after that backup (they are idempotent). Check
   `sql/005` in particular.
5. Re-insert the exported audit rows — the trail must show the incident and the restore.
6. Verify §7.2, including the **decrypt round-trip**, before reopening.

With PITR on, step 3 becomes *Point in Time* with a timestamp minutes before the incident.

### 5.3 Master project lost (deleted, account compromised, region outage)

Physical backups die with the project. **Today there is no copy to restore from** — this is the
scenario §3.4 exists to close.

Once a logical dump exists (§9 #3):
1. Create a new Supabase project, **us-east-1**, name `accounts-master`.
2. `pg_restore` the latest dump. Confirm row counts on `accounts`, `users`, `auth_methods`.
3. Set `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` in **Vercel and QMS Cloud Run** (same
   values), redeploy both. Traceability does not read master.
4. Update the Google OAuth client only if the callback host changed (it should not).
5. Verify §7.2 in full.

Without a dump: re-create schema from the QMS `design/sql` migrations plus `sql/001`–`005` here, then
re-enter every account by hand from the Orcanos-side records. Days, not hours, and every secret has
to be re-collected.

### 5.4 Tenant Supabase project — corruption or project loss

**Corruption:** freeze that tenant (Ask Paul kill switch on the account's *Ask Paul* tab), restore the
project's daily backup from its own dashboard, re-run `sql/bootstrap_new_account.sql` only if schema
objects are missing, verify §7.3.

**Project lost:**
1. Create a replacement project **in the region the account's data is supposed to be in** —
   check `accounts.region` and §3.3 before choosing. Record the decision.
2. Restore the logical dump if one exists; otherwise run `bootstrap_new_account.sql` and
   re-index the customer's documents from source (Google Drive ETL).
3. On the account window → *Ask Paul* tab → *Vector DB*: new host and service-role key. It must test
   green before it saves. The key is written to both the vector and legacy `db_*` columns.
4. Verify §7.3.

Remember the provisioning job cannot run DDL from Vercel (IPv6-only direct host, CLAUDE.md →
Provisioning) — run the bootstrap SQL through the Management API instead.

### 5.5 Traceability instance — volume or machine loss

1. `fly status -a traceability-matrix[-eu]` — confirm the machine/volume is really gone.
2. Create a new volume in the **same region** (`iad` or `fra`), same name `traceability_data`:
   `fly volumes create traceability_data -r iad -s 5 -a traceability-matrix`
3. `fly deploy` (or restart the machine attached to the new volume). The entrypoint sees an empty
   volume and runs `litestream restore` from `$BUCKET_NAME` automatically.
4. If automatic restore fails: `fly ssh console`, then
   `litestream restore -config /etc/litestream.yml -o /data/traceability.db /data/traceability.db`
   and restart. `BUCKET_NAME` is a real Fly secret precisely so this works by hand.
5. If the Litestream replica is unusable: restore the newest **Fly volume snapshot** instead
   (`fly volumes create ... --snapshot-id vs_...`) — up to 24 h older.
6. Verify §7.4.

Never scale to two machines to "get redundancy" — two writers silently corrupt the Litestream
replica (`litestream.yml` header).

### 5.6 Credential compromise

| Compromised | Do |
|---|---|
| A staff account | `update users set role='user' where id=…` in master — effective on the next request. Review `security_audit_log` for that `user_id` |
| `SUPABASE_SERVICE_ROLE_KEY` (master) | Rotate in Supabase; set in Vercel **and** QMS; redeploy both |
| `SUPABASE_ORG_ACCESS_TOKEN` | Revoke in Supabase account settings; issue new; Vercel; redeploy. Check the org for projects you did not create |
| `JWT_SECRET` | New value in Vercel and QMS together; redeploy both. Everyone signs in again |
| `ENCRYPTION_KEY` | **Do not just change it.** Run `backend/rotate_encryption_key.py` (QMS repo) first, then change both apps together. Then rotate every tenant secret it protected — they were readable to whoever held the key |
| A tenant credential | Rotate at source; enter the new value on the account window; audit shows `account_updated` with `secrets_rotated` |

### 5.7 Region-level provider outage

Supabase us-east-1 down = master and every tenant project down; there is no second region to fail
over to. Customer-facing impact: Ask Paul and QMS sign-in stop; traceability keeps running (its
`account_access` is local SQLite). Wait for the provider. A cross-region rebuild (§5.3 into another
region) is only justified for a multi-day outage and needs the residency decision (§1, principle 3) recorded
first.

---

## 6. Roles and authority

### 6.1 Who may do what

| Action | Who |
|---|---|
| Declare a DR incident | Any platform staff member |
| Authorise a restore (§5.2–5.5) | Platform owner (zoharp@orcanos.com), or a delegate named in writing |
| Execute | Whoever is on call, following this file |
| Verify and close | A **second** person, against §7 |
| Change residency during recovery | Owner + whoever signs off GDPR for the customer |

Single-person teams: record in §8 that verification was self-performed. An auditor accepts a
disclosed exception; not an undisclosed one.

### 6.2 Contacts

| | |
|---|---|
| Supabase support | dashboard → Support (Pro plan ticket) |
| Fly.io support | community.fly.io / billing plan support |
| Vercel support | vercel.com/help |

### 6.3 Key escrow — required, not yet done

`ENCRYPTION_KEY` and `JWT_SECRET` must exist somewhere that survives losing both Vercel and GCP:
a company password manager vault with two named holders. Record *where* here (never the value):

| Secret | Escrow location | Holders | Last verified |
|---|---|---|---|
| `ENCRYPTION_KEY` | ⬜ | ⬜ | ⬜ |
| `JWT_SECRET` | ⬜ | ⬜ | ⬜ |

Verification means decoding the escrowed value and confirming it decrypts one real master row —
not that the vault entry exists.

---

## 7. Verification checklists

### 7.1 Application

- [ ] Sign in with Google and with Orcanos; sign out
- [ ] Accounts list loads with totals and module pills (trace source reachable)
- [ ] Open an account → *Test Orcanos DB* goes green (proves `ENCRYPTION_KEY`)
- [ ] `GET /api/accounts` signed out → **404**
- [ ] Audit log shows the sign-in just made

### 7.2 Master

Everything in 7.1, plus:
- [ ] Row counts for `accounts`, `users`, `auth_methods`, `account_llm_keys` match the last known
      values (record them in §8 at every drill)
- [ ] **Decrypt round-trip:** a connection test on an account using the *stored* secret succeeds
- [ ] QMS AI sign-in works (it reads the same `users` / `auth_methods`)
- [ ] `security_audit_log` contains the restore itself and the re-inserted post-backup rows
- [ ] `sql/004`, `005` objects present if they were before
- [ ] Disaster recovery screen loads every row

### 7.3 Tenant Supabase

- [ ] Vector DB test green on the account's *Ask Paul* tab
- [ ] Ask Paul: sign in as that tenant, ask a known question, citations resolve
- [ ] Document / chunk counts within the expected range
- [ ] Project region matches `accounts.region` (or the recorded exception)

### 7.4 Traceability

- [ ] `/health` answers on the instance
- [ ] Accounts list here shows the Traceability/Training/BOM pills for that region (no banner)
- [ ] A tenant signs in and opens a panel that existed before the incident
- [ ] `fly logs` shows Litestream replicating again after restart

---

## 8. Drill programme and log

**Untested backups are not backups.** The schedule:

| Drill | Frequency | Method |
|---|---|---|
| Traceability restore | Quarterly | New scratch Fly app + volume in the same region, `litestream restore` from the real bucket, §7.4 against the scratch app, destroy |
| Supabase tenant restore | Quarterly | Restore `askpaul-orcanosdemo`'s backup into a **new** project (Supabase *restore to new project*), §7.3, delete |
| Master restore | Twice a year | Same, into a scratch project; point a local `run_dev.bat` at it; §7.2 including decrypt round-trip; delete |
| Key escrow check | Twice a year | §6.3 |
| Tabletop: master lost | Yearly | Walk §5.3 with no dump; list what could not be done |

For each drill, record measured RTO (start → verified green) and RPO (age of the data restored).
Every deviation from a runbook becomes an edit to this file before the drill is closed.

### Drill log

| Date | Drill | Store | RPO measured | RTO measured | Verified by | Deviations / fixes |
|---|---|---|---|---|---|---|
| — | *none performed yet* | | | | | |

A completed row here, linked from the ISO 27001 screen as the evidence for A.5.30 / A.8.13, is what
turns those controls from **fail** to **pass**.

---

## 9. To do, ordered

| # | Action | Closes | Cost / effort |
|---|---|---|---|
| 1 | Record `ENCRYPTION_KEY` and `JWT_SECRET` escrow (§6.3) | The only unrecoverable loss | 15 min |
| 2 | Decide orca60 residency (§3.3) | GDPR exposure | Decision |
| 3 | **Enable PITR on master** | Tier 0 RPO 24 h → minutes | Supabase PITR add-on + compute requirement |
| 4 | Nightly logical dump of master (+ tier-1 tenants) to storage outside Supabase, region-matched, ≥30-day retention | §5.3 has something to restore; history beyond 7 days | Small scheduled job |
| 5 | First traceability restore drill (cheapest, fully scripted already) | First §8 entry | 1 h |
| 6 | First Supabase restore drill | §8 | 2 h |
| 7 | Agree RPO/RTO with the owner (§4.2) | Targets become "met / not met" rather than "measured" | Decision |
| 8 | Verify the EU Litestream bucket is EU-restricted | Residency for EU traceability | `fly storage` / Tigris dashboard |
| 9 | Periodic export of `security_audit_log` | A.8.15 evidence outside the store it describes | Small |
| 10 | Alerting when the DR screen would show *At risk* / *Stale* | A.8.16 — today someone must open the page | Cron + email |
| 11 | A restore control on the DR screen | Only after 3–6 exist; destructive, needs typed confirmation | Later |

---

## 10. The Disaster recovery screen

`/disaster-recovery`, added in 0.7.0. **Read-only** — it triggers nothing.

| | |
|---|---|
| Route | `GET /api/accounts/backup-status`, `requirePlatformStaff()` |
| Source | Supabase Management API `GET /v1/projects/{ref}/database/backups`, token `SUPABASE_ORG_ACCESS_TOKEN` |
| Projects checked | Master (ref parsed from `SUPABASE_URL`) + each account's `vector_db_host` if it is `https://<ref>.supabase.co` |
| Concurrency | 5 simultaneous Management API calls |
| Per-row failure | Carried in the row (*Check failed*); the rest still render |

Verdict rules (`BackupsClient.tsx`):

| Condition | Pill |
|---|---|
| Account has no Supabase host | **No database** (warn) |
| Management API call failed | error text (err) |
| `pitr_enabled` false | **At risk** (err) |
| PITR on, no completed backup | **Stale** (warn) |
| Newest completed backup > 26 h old | **Stale** (warn) |
| otherwise | **Healthy** |

Things to know:
- **Each verdict carries its risk and recommended actions** (`ADVICE` in `BackupsClient.tsx`,
  keyed by `issueFor`, which mirrors the rules above). They appear in a *What needs attention* panel
  grouped by issue, and inline when a flagged row is clicked. The steps point back to §5 and §9.
  Change the advice there when a runbook here changes.
- **It does not cover traceability.** Litestream and Fly snapshots are invisible to it; check them
  with `fly` (§3.2).
- **Daily backups are counted but do not make a row healthy** — only PITR does. That matches the
  proposed Tier 0 target, and is harsher than necessary for Tier 2 demo projects.
- A non-Supabase or self-hosted `vector_db_host` shows *No database*, not *unknown*.
- The response shape was verified against the live API on 2026-09-16 (`pitr_enabled`,
  `walg_enabled`, `backups[].status/inserted_at/is_physical_backup`) — the tolerant parsing in
  `lib/backups.ts` matches it.
- Reads are not audited (SECURITY.md §8.3).
