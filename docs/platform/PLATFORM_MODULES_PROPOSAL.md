# Adding Training Management without breaking the Traceability Matrix

**Status:** proposal / consultation notes — nothing implemented
**Date:** 2026-08-28
**Written in:** `compliance-platform` (account-management workspace)
**Intended destination:** `traceability-matrix` repo (this is where the work would land)
**Companion doc:** [`PLATFORM_AUTH.md`](PLATFORM_AUTH.md) — the as-built auth model and the
membership/session proposal that §3.3 and D4 below depend on

---

## The question this answers

The traceability-matrix project started as a trace matrix. Training Traceability (a report) was
added as a second panel type. The next thing wanted is a **Training Management System** — assign
training, deliver quizzes, record completion.

Two worries drove the consultation:

1. "I don't want to duplicate code."
2. "It doesn't make sense that the trace matrix will be a training management system as well."

Both are right. The answer to (2) is mostly a *naming* fix; the answer to (1) is a module shell.

---

## Part 1 — What was verified in the codebase

Grounding facts, checked directly (paths relative to the `traceability-matrix` repo root):

### The panel model

`trace_setups` (see `SCHEMA.md`) is one table serving both existing features, discriminated by
`panel_type TEXT NOT NULL DEFAULT 'trace'`:

| `panel_type` | `levels` column shape | Engine |
|---|---|---|
| `'trace'` | JSON **array** of level configs (L1→L6) | `src/backend/matrix_engine.py` |
| `'training'` | JSON **object** `{kind, sources:{dms,users,tasks,records}, fields, rules}` | `src/backend/training_engine.py` |

Critical Note #24 already warns that because `levels` holds two incompatible shapes, every reader
must route on `panel_type` **first** — `matrix_engine.normalize_blocks()` would mis-parse a
training row. Four explicit guards enforce this today (`matrix/execute`, both funnel routes,
`PUT /api/config/{id}`), and `/api/training/*` refuses a trace row.

**Read: the discriminator is already under strain with two members.**

### The frontend shell

`src/frontend/src/App.jsx` is a single flat `<Routes>` block with no module concept. It already
does capability-gated routing off `/api/auth/status`:

- `aiEnabled` (`user.ai_enabled !== false`) — account AI licence, fails open
- `canManagePanels` (`user.can_manage_panels !== false`) — Orcanos dashboard-add right, fails open
- `isAdmin` (`user.is_admin === true`) — gates writes, fails closed

Routes today: `/login`, `/dashboard`, `/config`, `/config/describe`, `/config/:setupId`,
`/knowledge`, `/knowledge/:productId`, `/prompts`, `/build/:setupId`, `/matrix/:setupId`,
`/training/new`, `/training/:setupId/edit`, `/training/:setupId`.

The header is hardcoded: Orcanos logo + `"Orcanos Traceability Matrix – {account}"` + Help + UserMenu.

**Read: the gating mechanism needed for per-module licensing already exists and is proven.**

### The backend layout

`src/backend/` is **flat** — ~35 modules in one directory (`app.py`, `auth.py`, `db.py`,
`matrix_engine.py`, `training_engine.py`, `orcanos_client.py`, `export_jobs.py`,
`access_control.py`, `ai_provider.py`, `ai_usage.py`, …). No package structure, no module
boundaries.

**Read: fine for two features, will not survive three. But do not big-bang refactor it (see phasing).**

### Deployment reality

Documented target is Windows Server IIS + SQLite. But the repo also contains `fly.toml`,
`litestream.yml`, `Dockerfile`, and `docker-entrypoint.sh` — so a Fly.io + Litestream-replicated
SQLite path exists alongside the IIS one.

---

## Part 2 — The core insight

**Trace matrix and Training Traceability are the same kind of thing. Training Management is not.**

|  | Trace matrix | Training Traceability | Training **Management** |
|---|---|---|---|
| Direction | read-only | read-only | **read/write** |
| Data source | Orcanos | Orcanos | **itself** |
| Anchored on | a `trace_setups` row | a `trace_setups` row | **nothing — it has no panel** |
| Primary user | QA manager | QA manager | **the trainee** |
| Output | a computed + cached report | a computed + cached report | **new records** |

`panel_type` is a discriminator on *"a configured report"*. Training Management is not a configured
report, so `panel_type='training_mgmt'` would be forcing a third, incompatible thing through it —
and `levels` would gain a third shape. That is how `trace_setups` becomes a junk drawer.

**Conclusion: not a new panel type. Also not a separate app. A third option — a module.**

---

## Part 3 — The recommendation

### 3.1 Rename the container

The product and the module currently share a name, which is the whole source of worry (2).
Separate them:

- **The platform** — owns login, accounts, the Orcanos client, the design system, the app shell.
  (Name TBD: "Orcanos Compliance Suite" or similar.)
- **Traceability** — a module. Today's `/dashboard`, `/config`, `/matrix`, `/build`, `/knowledge`.
- **Training** — a second module, with two halves:
  - *Management* (new, write-capable)
  - *Insight* — the existing Training Traceability report, moved under it

Once the container has its own name, "the trace matrix is also an LMS" is a sentence nobody has to say.

### 3.2 Portal screen vs contextual layout — it's both

These are not competing designs. The portal is a route; the layout switch is the shell reading the
active module off the URL prefix. One mechanism serves both.

```
/                  → Portal launcher (tiles: Traceability · Training · …)
/trace/*           → module shell: traceability nav
                     dashboard, config, config/describe, config/:id,
                     matrix/:id, build/:id, knowledge, knowledge/:id, prompts
/training/*        → module shell: Catalog | Assignments | My Training | Reports
                     reports/*  ← existing Training Traceability panels live here
                     catalog/*, assign/*, my/*  ← new management surface
```

Structure: platform logo → **module switcher** → module-specific nav. One shell component, one CSS
token set, three module bodies.

### 3.3 Per-module licensing (reuse what exists)

Add `modules: ['trace','training']` to the `/api/auth/status` payload, alongside `ai_enabled` /
`can_manage_panels` / `is_admin`. Then:

- The portal renders only licensed tiles.
- **If exactly one module is licensed, redirect straight past the portal.** Existing traceability-only
  customers see *no change at all*.
- Keep `/dashboard` → `/trace/dashboard` (and siblings) as permanent redirects for bookmarks.

Follow the existing convention on fail-open vs fail-closed, and keep backend 403s regardless of what
the UI shows.

### 3.4 The design decision to build the whole thing around

> **Keep Orcanos as the system of record for training records.**

The Training Management module owns *operational* data only — quiz definitions, assignments,
attempts, in-progress answers, retry counts. On pass, it **writes the training record back into
Orcanos**.

Why this is the load-bearing choice:

1. **The two halves snap together for free.** Training Traceability already reads Orcanos
   DMS/users/tasks/records. Training delivered by the new module is therefore evidenced by the
   existing report with *zero* new integration.
2. **It dodges 21 CFR Part 11.** Training completion is regulated evidence. If a local SQLite file
   becomes the record, the project owes audit trail, e-signature, retention, and validation. If
   Orcanos holds it, Orcanos already does.
3. **The local DB stays low-stakes and disposable** — which matters, because SQLite-on-IIS is fine
   for report caches and shaky as a compliance record store.
4. **It's the honest product story for a QMS vendor:** not a competing LMS, but the *delivery*
   front-end for training Orcanos already governs.

---

## Part 4 — What to do with `quiz-management`

`c:\AI Projects\quiz-management` is already ≈ the training management system being asked for. But:
Next.js 16 + Supabase Auth + client-only Supabase queries, at `0.1.0`, with 13 open "Critical
Implementation Notes" and route guards that are explicitly cosmetic (real boundary is RLS).

**Recommendation: absorb the domain, discard the code.** Port the schema and the flows (its 14
migrations and `SCHEMA.md` are the genuinely valuable asset) into the FastAPI + React stack as the
Training module.

Reasons:

- Its auth model (Supabase Auth) directly conflicts with the platform's real auth (Orcanos
  `qw_login` → httpOnly cookie + CSRF). Bridging two session models is permanent complexity.
- Two frontends cannot share a layout shell — which defeats the entire point of the portal.
- The duplication actually worth avoiding *is* auth, tenancy, design system, and the Orcanos
  client. Keeping quiz-management separate duplicates all four, forever.

**Cheaper deferral, if needed:** the portal tile links out to quiz-management as a separate
deployment, SSO deferred. Buys time; the bill is paid later at a higher price.

---

## Part 5 — Phasing

Ordered so that each step is independently shippable and the risky step comes last.

| # | Step | Risk | Customer-visible change |
|---|---|---|---|
| 1 | **Shell + portal only.** Introduce `/trace/*`, module switcher, `modules[]` in auth status, single-module auto-redirect, legacy route redirects. | Low | **None** (that's the point) |
| 2 | **Move Training Traceability under `/training/reports/*`.** Still `panel_type='training'` underneath; only routes and chrome move. | Low | Nav only |
| 3 | **Add Training Management** — new tables, own backend package, completion written back to Orcanos. | High | New module |
| 4 | **Extract shared code only when step 3 demands it.** | — | None |

On step 4 — do **not** pre-refactor the flat `src/backend/`. The modules that will actually get
shared are `orcanos_client.py`, `auth.py`, `access_control.py`, `db.py`, `export_jobs.py`. Most of
the rest is trace-specific and should just move into `modules/trace/` when it's convenient, not
before. New code goes in `src/backend/modules/training/` from day one.

---

## Part 6 — Open decisions (owner's call, needed before step 3)

### D1. Datastore

Step 3 is where SQLite gets uncomfortable — concurrent writes from trainees, real referential
integrity, backup/restore. `litestream.yml` + `fly.toml` mean a Fly path already exists.

> **Question:** is IIS + SQLite still the deployment target for new customers, or is Fly (or
> Postgres) now the default and IIS the legacy variant?

### D2. Does Training Management have to work *without* Orcanos?

If some customers want training delivery without an Orcanos licence, the "Orcanos as system of
record" design (§3.4) breaks and the module needs its own record store — with the full Part 11
burden attached.

> **Question:** Orcanos-required, or standalone-capable? This is a fork in the road, and it must be
> decided before step 3 starts, not during.

### D3. One Training module or two?

Recommendation is **one** module with Management and Insight as sections, because they answer the
same compliance obligation from two ends (delivering training vs evidencing it) and users will want
them adjacent. The alternative — two sibling modules — is defensible if the buyers differ.

### D4. Where does account management live?

The `compliance-platform` workspace is now the account-management project. If it becomes the
platform's account/tenant authority, then `modules[]` in §3.3 should be *sourced from it* rather
than hardcoded per deployment. Worth settling early — it changes where the licence check lives.

> **Answered in [`PLATFORM_AUTH.md`](PLATFORM_AUTH.md) §3.1**: the master DB is the authority, and
> `modules[]` should hang off a new `user_accounts` table there. Its D3 asks the remaining part —
> whether the licence is per tenant or per user.

---

## Appendix — What was explicitly rejected, and why

| Option | Why not |
|---|---|
| `panel_type='training_mgmt'` | Training Management has no panel. Would give `levels` a third incompatible shape and worsen Critical Note #24. |
| A third standalone app | Duplicates auth, tenancy, design system, and the Orcanos client — exactly the duplication to be avoided. |
| Keep quiz-management as-is, bridge Supabase Auth ↔ Orcanos sessions | Permanent two-session complexity; two frontends can't share a shell. |
| Big-bang refactor of `src/backend/` into packages before adding the module | High risk, zero customer value, and the real seams aren't known until step 3 exercises them. |
