# Change file — data residency (EU / US) and the hardening that came with it

**Window covered:** 2026-09-09 → 2026-09-10
**Repos:** `traceability-matrix` (3.42.x → **3.45.1**) · `orcanos_qms_AI` (BE 2.38.5 → **2.39.0**, FE 1.39.0 → **1.40.0**) · `account-management` (0.3.4 → **0.6.0**)

This file exists to be read once and then folded into
[`ORCANOS_AI_INFRASTRUCTURE.md`](ORCANOS_AI_INFRASTRUCTURE.md). It records **what changed and
why**, in the order it happened, so the handbook can be updated from it rather than from a
commit log.

---

## Table of contents

1. [The one-sentence summary](#1-the-one-sentence-summary)
2. [Why now — what is actually being protected](#2-why-now--what-is-actually-being-protected)
3. [The shape: one deployment per region](#3-the-shape-one-deployment-per-region)
4. [The signpost that grants nothing](#4-the-signpost-that-grants-nothing)
5. [The login hand-off, and the bug that made it look broken](#5-the-login-hand-off-and-the-bug-that-made-it-look-broken)
6. [Moving a tenant between regions](#6-moving-a-tenant-between-regions)
7. [Ask Paul: region-aware provisioning](#7-ask-paul-region-aware-provisioning)
8. [Account Management: the console that drives all of it](#8-account-management-the-console-that-drives-all-of-it)
9. [The admin console hardening that came out of the same work](#9-the-admin-console-hardening-that-came-out-of-the-same-work)
10. [⚠️ What is NOT residency yet](#10--what-is-not-residency-yet)
11. [Secrets: the parity trap](#11-secrets-the-parity-trap)
12. [New vocabulary](#12-new-vocabulary)
13. [What the handbook must change](#13-what-the-handbook-must-change)

---

## 1. The one-sentence summary

An account now has a **data region** — `us` or `eu` — chosen when it is created and never
changed; the Traceability platform runs as **two separate deployments** (`iad` and `fra`) that
share no data, the login screen hands a customer to their own region automatically, a tenant can
be physically moved between regions, and Ask Paul provisions its per-customer vector database in
the matching Supabase region.

**The single most important caveat:** an EU vector database is **not** end-to-end EU residency.
See [§10](#10--what-is-not-residency-yet).

---

## 2. Why now — what is actually being protected

Orcanos holds the requirements, but *our own* databases hold their own copies of personal data:

| Where | Personal data in it |
|---|---|
| `matrix_cache` / `source_cache` / `funnel_cache` | Trainee **names, emails, roles, completion dates** — training snapshots |
| `quiz_attempts` / `quiz_answers` | Somebody's **exam record**, and the one thing Orcanos cannot rebuild |
| `sessions.auth_header` | The user's **real Orcanos credential**, encrypted |
| Ask Paul's per-customer Supabase | The customer's **document text and its embeddings** |

We are the **processor**; the tenant is the **controller**. An EU customer contracting for GDPR
residency needs that data to rest in the EU.

---

## 3. The shape: one deployment per region

**There is no "EU mode". There is an EU deployment.**

A Fly volume is pinned to one region and is never shared between machines, so `fly scale count 2`
does not produce a region — it produces **two divergent databases with nothing reporting the
split**. So:

| | US | EU |
|---|---|---|
| Fly app | `traceability-matrix` | `traceability-matrix-eu` |
| Config file | `fly.toml` | **`fly.eu.toml`** (new) |
| Fly region | `iad` (Virginia) | `fra` (Frankfurt) |
| Volume | own | own (`vol_4919qpz9m39mx59r`) |
| SQLite database | own | own |
| Litestream bucket | own | `traceability-matrix-eu-db` |
| Replication between them | **none — that is the feature** | |

Deploying is now **two commands**:

```bash
fly deploy                      # US
fly deploy -c fly.eu.toml       # EU
```

`deploy.bat` states explicitly that it deploys the **US app only**.

**`SELF_REGION`** is the whole of an instance's identity. Two apps sharing one value is a
deployment mistake nothing else would catch, so `GET /api/admin/regions` returns `self_region`
and the console checks it.

### ⚠️ Two setup steps that silently void the whole thing

1. **The Litestream bucket.** Tigris distributes objects **globally by default**, so an EU
   database's write-ahead log lands on US edges while every other part of the deployment looks
   correct. Restrict the bucket to EU regions in the Tigris dashboard, or point
   `LITESTREAM_BUCKET` at an EU-only S3/R2 bucket. **Nothing in the app can detect this.**
2. **A fresh region is an open door until its allowlist has a row.** An empty `account_access`
   fails open by design — correct for a first install on a laptop, exactly wrong for a brand-new
   public Fly app. `traceability-matrix-eu` answered `allowed: true` to **every** tenant for the
   minutes between its first deploy and its first row. The fix is a **denied sentinel row**
   (`zz-gate-closed`, `allow_access: 0`), which makes the count non-zero and therefore turns the
   gate on without granting anything. Write it **before announcing the URL**; delete it once the
   region has real tenants.

---

## 4. The signpost that grants nothing

Each instance holds only its own region's tenants, so an EU tenant has **no `account_access` row
in the US database at all** — and the old code therefore told them *"Access is not allowed.
Please contact us to open an account."* That is false, and it is a dead end.

**`account_region`** is a new two-column **directory** (tenant → region) held **identically in
every instance**. It carries a tenant name and a region string — **no personal data** — so
copying it across the border is not a transfer of anything.

> ⚠️ **It grants nothing, and that is load-bearing.** `account_access` remains the only permission
> gate. `region_check()` treats a missing directory entry as *"no idea"*, never as *"here"*. That
> is what makes the console's cross-region write safe to do **best-effort**: a region that missed
> the signpost costs that tenant a worse error message — never access to the wrong region's data.
> **Nothing may consult the directory in a gate.**

---

## 5. The login hand-off, and the bug that made it look broken

### 3.43.0 — a signpost with a link

`POST /api/auth/check-account` (which already fired on URL blur, **before the password fields
unlock**) returns `status: "wrong_region"` with `region_url`. `/login` enforces it as **409 with
the correct URL**, not 403 — nothing is wrong with the account, the request arrived at the wrong
deployment.

**The redirect must happen before the password is submitted.** Credentials POSTed to the wrong
region are themselves a cross-border transfer of personal data, even though that instance refuses
them and stores nothing.

### 3.45.0 — one address for everyone

Which region holds a customer's data is **our implementation detail**, not something they should
have to know or bookmark. The login screen now hands them over **automatically**, carrying the
Orcanos URL they typed in the query string so they do not type it twice.

- **`rr=1` is a loop guard and it is not theoretical.** The two instances hold separate copies of
  the directory. If they ever disagree — a half-finished move, a directory write that failed on
  one side — an automatic redirect bounces the browser between two servers forever, each certain
  the customer belongs to the other. Arriving with the flag set means *"you have been sent once
  already"*: fall back to the panel with the link and let a person decide.
- ⚠️ **The address bar does change.** A true single origin would need an edge proxy in front of
  both apps, which puts a third processor in the path of every EU request.

### 3.45.1 — the bug, and it is worth reading

Report: *"I'm on eu.traceability, I change the Orcanos URL to another account, it refreshes and
goes back to the previous URL."* A three-step bounce, not a failure to navigate:

1. The hand-off sent the browser to `https://traceability.orcanos.ai/?rr=1&u=<typed url>`.
   `REGION_URL_*` is a bare origin, so it landed on `/`.
2. While signed out, `/` is not a route. The catch-all `<Route path="*" element={<Navigate
   to="/login" />} />` caught it — and **`<Navigate>` drops the query string.** Both parameters
   died there: `u` (the URL to prefill) and `rr` (the loop guard).
3. So the US app opened its login screen with its **default** account, `app.orcanos.com/orca60` —
   which is now an **EU** tenant. With the loop guard gone too, it forwarded straight back.

Fixed in two places deliberately: `LoginRedirect` preserves `search` + `hash`, and `handOffTo`
now sets `pathname = '/login'` so the hand-off never touches the catch-all at all.

**Found by the test rather than reported:** the placeholder the form opens with was being treated
as a real answer, so **every first-time visitor to the US address was thrown to Frankfurt before
touching anything**. `checkAccount` now takes `allowHandOff` — only a URL somebody stands behind
(typed, or saved) can forward the browser.

> **Lesson worth keeping:** the first attempt at this was shipped on reasoning alone and did not
> fix it. Reproduce first.

---

## 6. Moving a tenant between regions

Residency means the two regions share no data, so *"move to the EU"* is a **physical migration**,
not a flag. `src/backend/tenant_move.py` + `/api/admin/tenants/*`, driven from the
Account Management console.

**Order is the safety:**

```
freeze → export → import → COMPARE ROW COUNTS → restore access → update master + directory → purge
```

The purge is **last**, so a short import stops the move with the source fully intact. The import
is **one transaction**; a half-landed import is the state that would make *"may I delete the
source?"* unanswerable.

| Decision | Why |
|---|---|
| The per-tenant table list is **DISCOVERED from the schema** | It has grown every few releases. A hand-maintained list is correct the day it is written and silently short after — and short here means a customer's quiz attempts stay on the wrong continent while the move reports success |
| **Two keys, both needed** | One tenant can own several `accounts.id` values (the table is unique on `(url, virtual_dir)`, so the same tenant on two hosts is two rows), and three tables key on the tenant **name** instead |
| **`sessions` never travels** | It holds the encrypted Orcanos credential under a key that is deliberately different per region, so a moved row would be undecryptable anyway. It **is** purged from the source — that is the point |
| **Caches DO travel** | They look disposable and are not: a training report renders the snapshot and never re-reads Orcanos, so dropping them discards the evidence behind training records the customer has already signed off |
| **Ask Paul does not move** | Its per-tenant vector database is a Supabase project, which cannot be relocated. The response says so rather than leaving it to be found later |

Everyone signed in gets signed out. The console requires the tenant name to be typed.

---

## 7. Ask Paul: region-aware provisioning

**BE 2.39.0 / FE 1.40.0 — `REQ-047`.**

### ⚠️ The bug this fixed was invisible

`provision_account()` declared `region: str = "us-east-1"` and its **only caller never passed
it**, so **every customer ever provisioned from this app landed in Virginia**, whatever they had
contracted for. A database in the wrong region works perfectly — every query succeeds, no error
is raised, nothing in the product reports it. The mistake was undetectable from behaviour and
would have surfaced only in an audit.

### What changed

- `provision_account(account_name, data_region)` — `data_region` is **required**, mapped through
  `SUPABASE_REGION_BY_DATA_REGION` (`us` → `us-east-1`, `eu` → `eu-central-1`). An unknown value
  **raises** rather than falling back.
- `POST /admin/accounts` answers **400** on a missing or invalid `region`, and writes it to the
  account row in the same request, so the recorded region and the region the project was actually
  created in cannot disagree.
- `CreateAccountModal` has a Data Region selector with **no pre-selected value**, and states that
  the choice cannot be changed later.

**The default was removed rather than corrected**, because a correct default is still a default:
the next caller that omits the argument gets a silent residency decision made for it. Refusing
the request is the only failure mode visible at the moment the mistake is made.

**`accounts.region` is deliberately the same column** the Traceability platform and the
Account Management console read off the shared master database. A customer has **one** region,
not three settings that can drift apart.

---

## 8. Account Management: the console that drives all of it

0.4.0 → 0.6.0, in order:

| Version | What |
|---|---|
| **0.4.0** | `accounts.region` (`us` \| `eu`), chosen at creation. Every existing account backfilled as `us`, which is where it already is. The editor **refuses** a change rather than accepting it quietly — rewriting the value moves no data, it only records the customer as living somewhere they do not |
| **0.4.1** | The console talks to **one Traceability instance per region**: the list reads every configured region, and each licence change, AI setting, usage read and deletion goes to the instance that actually holds that tenant. A new account is **signposted in every region**, best-effort. Creating an EU account is **refused** while no EU instance is configured — it would have written the tenant's data to the US while recording it as EU |
| **0.4.2** | **One admin password per region** — `TRACE_ADMIN_PASSWORD` (US), `TRACE_ADMIN_PASSWORD_EU`. The two databases never travel together, so one password covering both would mean one leak opening both regions' admin APIs. A region counts as configured only with **both** a URL and its own password; there is no fallback |
| **0.5.0** | One screen per account (tabs). **Region column on the list**, read from the instance that actually holds the data rather than from what was recorded — when the record and the instance disagree the row is flagged as a **conflict**, because one of them is wrong and nothing here can tell which. Region move from the account screen. Delete now needs `DELETE` typed |
| **0.5.1 / 0.5.2** | Tab strip no longer clipped. The region move shows its **seven steps** as soon as the confirmation is typed — the plan is readable before the move is authorised — each ticked off with the row counts actually moved |
| **0.6.0** | Six tabs — Overview, Orcanos, Traceability, **Ask Paul**, **LLM**, Spend — one per *system* rather than one per *table*. Both AI configurations in one place. Both cost ledgers in Spend, listed separately rather than summed (one is a lifetime counter, the other a total over the events shown) |

Migration: `sql/003_account_region.sql`, applied to master.

---

## 9. The admin console hardening that came out of the same work

A question about viewing the SQLite tables in production turned up two things worse than the
missing feature. **v3.44.0:**

### `ADMIN_PASSWORD` no longer has a default

`/admin` is a FastAPI route on the **same public host as the app**, so `https://<host>/admin` is
reachable by anyone. The shared password in front of it fell back to a literal written in
`admin_api.py`. **Every deployment that had not set the secret was fully administrable by anyone
who had read the repository** — and a working login looks identical whether the password was
configured or guessed. `_require_configured()` now answers **503** when it is unset.

> ⚠️ **Deploying 3.44.0+ requires setting `ADMIN_PASSWORD` on both regions FIRST**, or `/admin`
> goes 503 the moment it ships. Secrets are read at process start, so setting them restarts the
> machines — which is what makes it safe to set them before the code that requires them.

### A staged login throttle ending in a permanent block

**10** failures → 5-minute pause · **15** more → an hour · **25** more → **permanent block**
(50 guesses total). The first stage is deliberately generous — a real admin trying an old
password must not be punished — and the stages widen because somebody who has burned 25 guesses
is not mistyping. Both are checked **before** the password is compared, so a correct password
during a pause is still refused; that also stops the lockout being a timing oracle for *"this
guess was right"*.

- **The two halves have different lifetimes on purpose.** The temporary stages are a
  process-memory dict — a restart clears them, each Fly machine counts separately, so the
  guessing budget is multiplied by the machine count rather than removed. That is the price of
  never writing to the shared SQLite file on an unauthenticated path. The **permanent** block is
  a row in the new `admin_blocked_ips` table, because a permanent block a restart clears is not
  permanent. `GET /blocked` returns them as **two labelled lists**, so a shorter list after a
  restart does not read as lost rows.
- **A permanent block can lock out the only admin**, and the Release button lives inside the
  console they can no longer reach. The out-of-band escape is starting the process once with
  `ADMIN_UNBLOCK_ALL=1`, which clears the table at startup and logs loudly that it did.
- **Reading the blocked list fails OPEN** — a database hiccup must not be what locks an admin out.

### A read-only table browser, off unless `ADMIN_DB_BROWSER=1`

`src/backend/db_browser.py`. Its blast radius is *"every row in production"*, so it does not
exist on a deployment that has not deliberately asked for it.

- **Injection is prevented by membership, not escaping.** No WHERE, no ORDER BY, no query box.
  The caller picks a table **name**; that name is checked for membership in the list
  `sqlite_master` actually returns **before** it is interpolated. `LIMIT`/`OFFSET` are bound
  parameters. *Adding "just a small filter box" throws that property away.*
- **The connection cannot write** — `PRAGMA query_only = ON`.
- **Credentials never leave the process.** `REDACT` names `sessions.auth_header`,
  `sessions.session_id` (which **IS** the bearer cookie), `sessions.csrf_token`,
  `ai_config.api_key`; `REDACT_NAME` additionally matches any column whose *name* looks like a
  secret. ⚠️ **A missed entry is not a visible bug — it is a silent disclosure on a page reachable
  from the internet.** Add the column to `REDACT` in the same commit that adds the table.
- **Cells are cut at 400 characters** — the cache tables hold multi-MB JSON blobs.

---

## 10. ⚠️ What is NOT residency yet

**Ask Paul's vector DB being in Frankfurt while the backend and embeddings are in the US is a
residency claim that reads as true and is not.**

| Part | State |
|---|---|
| Traceability app + database | ✅ per-region deployment |
| Ask Paul vector DB region | ✅ per-account, chosen at creation |
| Ask Paul FastAPI backend | ❌ **one Cloud Run service, `us-east4`** — every EU customer's questions and document text are processed in the US |
| Embeddings | ❌ **always OpenAI on the platform key**, no per-account override |
| Chat LLM | ⚠️ per-account engine; only `bedrock_claude` uses an EU inference profile (`eu.anthropic.…`) — the Anthropic / OpenAI / Gemini branches are US |
| Traceability AI calls | ❌ **not region-routed.** Panel-describe, trace-build and quiz-generation send requirement text and trainee names to the US Anthropic API |
| SSO into Ask Paul from the EU app | ❌ deliberately unconfigured — see §11 |
| EU Litestream bucket restriction | ⚠️ **unverified from the CLI** |

**An EU customer is compliant only when the whole column is.** A US call for an EU tenant returns
a perfectly normal answer, which is exactly the problem.

---

## 11. Secrets: the parity trap

`fly deploy -c fly.eu.toml` ships the **identical image**. What it does **not** ship is the other
app's secrets — those are per-app, write-only, with no "copy from" operation. So a second region
comes up running the same build with a **different set of features switched on**, and nothing
anywhere says so.

Found the ordinary way: a tenant was moved US → EU, signed in, and **Ask Paul was gone from the
main screen.** The move was flawless — `allow_access.allow_ask_paul` arrived as `1`, verified in
the EU database. The button was hidden because `ASK_PAUL_APP_URL` / `ASK_PAUL_SSO_SECRET` had
never been set on `traceability-matrix-eu`.

> **The features that vanish are exactly the ones written to fail CLOSED.** That is not a
> coincidence and not a bug in them. But "fails closed" plus "new region" reads to the customer
> as **a licence they paid for that is missing**, and to the operator as a bad move, because the
> licence row is right there saying `1`.

**⚠️ Diagnose in this order**, or you will blame the wrong layer. A hidden Ask Paul button has
**four** independent causes and only the last is visible in the console:

```
ask_paul_enabled = allow_ask_paul        (the ACCOUNT's licence — /admin, and the console)
                 AND can_ask_paul        (the USER's own Orcanos "O" letter — fail-open)
                 AND ask_paul_configured (this DEPLOYMENT's two secrets — fail-CLOSED)
```

Check `fly secrets list` **before** touching a licence.

**⚠️ Secret parity is not the goal — a DECISION per secret is:**

| Secret | US | EU | The decision |
|---|---|---|---|
| `ADMIN_PASSWORD`, `SECRET_KEY` | set | set | **Different per region, deliberately.** One leak must not open both |
| `SESSION_ENC_KEY` | set | set | **Must differ** — the databases never travel together |
| `AWS_*`, `BUCKET_NAME` | set | set | **Must differ** — and the EU bucket must be EU-restricted |
| `ADMIN_DB_BROWSER` | set | set | Same value is fine — a feature flag, not a credential |
| `ASK_PAUL_APP_URL` / `ASK_PAUL_SSO_SECRET` | set | **unset** | ⚠️ Needs an **EU Ask Paul deployment** first. Do **not** point EU at the US app |
| `ANTHROPIC_API_KEY` | set | **unset** | ⚠️ Regional Bedrock endpoint — not the US key |

**The two unset rows are a residency decision, not an oversight.** An operator who finds them
blank at 2 a.m. will "fix" them by copying, because copying is what parity means everywhere else.
Wiring either into the EU app sends EU personal data to the US **through a deployment whose entire
purpose is that it does not** — a residency breach that looks like a feature working.

**Nothing detects the drift.** Both regions serve real customers on the same build: no version
mismatch, no error, no failing health check — only a customer in one region who cannot see
something a customer in the other one can.

---

## 12. New vocabulary

| Term | Meaning |
|---|---|
| **Data region** | `us` or `eu`. One value per account, on `accounts.region` in master. Chosen at creation, **immutable** |
| **Regional instance** | One of the two Traceability deployments. Its identity is `SELF_REGION` |
| **`account_region`** | The cross-region **directory** (tenant → region). Grants nothing |
| **Hand-off** | The automatic redirect from the wrong region's login screen to the right one, pre-credentials |
| **`rr=1`** | The loop guard on the hand-off URL: *"you have been sent once already"* |
| **Region move** | The physical migration of one tenant's rows between regions |
| **Region conflict** | The console's flag when the recorded region and the instance holding the data disagree |
| **Denied sentinel row** | `zz-gate-closed` — closes a fresh region's fail-open allowlist without granting anything |

---

## 13. What the handbook must change

| Chapter in `ORCANOS_AI_INFRASTRUCTURE.md` | Change |
|---|---|
| §3 Environments | Fly is now **two apps**, not one. Add `fly.eu.toml`, the two deploy commands, the Litestream-bucket trap |
| §4 Single- vs multi-tenant | Add the region axis: multi-tenant **within** a region, one database **per** region |
| §6 Authentication | Add the region hand-off — pre-credentials, and why |
| §7 Silent SSO | Add the fourth failure cause: the deployment's own secrets, EU deliberately unset |
| §9 Databases | `account_region`, `admin_blocked_ips`, `accounts.region` |
| §12 Security | `ADMIN_PASSWORD` has no default; the throttle; the DB browser; the fresh-region open door |
| §13 ISO 27001 | Residency is now a control we partly hold, with a named gap list |
| §19 Admin manual | Region selector at creation, region column, conflict flag, the seven-step move |
| §21 Next steps | Replace with the §10 gap list |
| **New chapter** | **Data residency (EU / US)** — the whole of this file, condensed |
