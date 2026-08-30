# The four source projects, and the case for consolidating them

Reference note for the consolidation. Each source project's own `CLAUDE.md` remains the source of
truth for its codebase; this file summarises what each one is, how it is built, and what it would
take to bring them together.

It was the `compliance-platform` workspace's `CLAUDE.md` until 2026-08-29, when it moved in here so
it would live in a repo — the workspace folder itself is not one. What remains outside is
`deploy.bat`, one level above the repo root.

## Where the work landed

| App | Repo | Status |
|---|---|---|
| **this repo** — `account-management/` | `zoharp/account-management` | **v0.2.5 — live at https://accounts.orcanos.ai** (deployed 2026-08-29). The platform control plane — tenant accounts, their databases, spend, and the security audit trail. Extracted from the Accounts panel in Orcanos QMS AI; Next.js on Vercel, standalone. Google sign-in works against the live master DB; email sign-in is Orcanos `QW_Login`-backed instead of internal bcrypt. All three migrations are applied — nothing outstanding. See [`CLAUDE.md`](../../CLAUDE.md). |

**Workspace script (outside this repo, in the parent folder):** `deploy.bat` is the deploy button.
It picks an app and hands over to that app's own `deploy.bat`, which keeps its own gates — it
deploys nothing itself. `deploy.bat account-management` skips the menu. To add an app: give it a
`deploy.bat`, add an `APP_n`/`DESC_n` pair and bump `APP_COUNT`.

**Workspace docs (not tied to one app):**

| Doc | What it is |
|---|---|
| [`PLATFORM_AUTH.md`](PLATFORM_AUTH.md) | As-built record of how authentication actually works across all five projects (master `users`, the shared HS256 JWT, where `QW_Login` is and isn't used), plus the proposal to add tenant membership and fold Orcanos login into one session model. §5 carries the decisions taken 2026-08-28: Orcanos `QW_Login` as the platform's email sign-in, and how it joins to master `users`. Read this before touching anything under `src/lib/session.ts`, `src/lib/login.ts` or `src/app/api/auth/`. |
| [`PLATFORM_MODULES_PROPOSAL.md`](PLATFORM_MODULES_PROPOSAL.md) | The module portal — per-module licensing and where account management lives. Proposes adding Training Management to traceability-matrix as a module rather than a panel type. Its §3.3 and D4 depend on `PLATFORM_AUTH.md`. |

**The direction:** this repo is the consolidation's first landing point. Platform
management that today lives inside Orcanos QMS — cost, users, accounts, AI setup — moves here one
area at a time. The QMS Accounts panel is deliberately still running; the two are meant to be
compared against the same master database before the old one is retired.

**Source projects (all under `c:\AI Projects\`, all private GitHub repos under `zoharp/`, all on `main`):**

| # | Folder | Repo | What it is |
|---|---|---|---|
| 1 | `covaris-bom` | `covaris_bom` | Read-only BOM tree browser over Orcanos |
| 2 | `Orcanos QMS` | `orcanos_qms_AI` | Multi-tenant RAG compliance assistant + IEC 62304 pipeline |
| 3 | `quiz-management` | `quiz-management` | Multi-tenant training-quiz platform |
| 4 | `traceability-matrix` | `traceability-matrix` | Requirement→test traceability + training traceability panels |

Each source project keeps its own `CLAUDE.md`, which stays the source of truth for that
codebase. This file summarizes; it does not replace them. The summaries below are a snapshot —
verify a version or a file path against the project itself before relying on it.

---

## 1. Covaris BOM Viewer — `c:\AI Projects\covaris-bom`

**Version:** app `1.6.2` · **Docs:** `CLAUDE.md` (authoritative), `COST_MODEL.md`, `README.md`

A read-only React SPA that browses Bill of Materials trees in the Orcanos QMS tenant at
`https://us.orcanos.com/covaris/`. Users sign in with their own Orcanos credentials, see
top-level BOMs in a custom tree-grid, and lazy-expand children on demand.

- **Stack:** React + Vite + plain CSS. No Tailwind, no Redux, no react-router, no tree library.
- **Backend:** none. The only server-side piece is a path rewrite (`/api/orcanos/*` → Orcanos),
  done by the Vite dev proxy locally and a `vercel.json` rewrite in production. Orcanos sends
  no CORS headers, so the proxy is mandatory.
- **Deploy:** Vercel static build, auto-deploy on push to `main`.
- **Config:** read-only `public/settings.xml` shipped with the build (version id, four saved-filter
  ids, page size, BOM name prefixes, an image access token). No settings UI — edit the XML and redeploy.
- **Orcanos API:** three call sites, all in `src/api/orcanosClient.js` — `QW_Login` and
  `QW_Get_Filter_Results` (BOMs / part instances / part catalog / related ECOs).
- **Notable features:** Where Used + Locate (BFS expand-and-highlight), export
  (hierarchic/summary × JSON/CSV/HTML/PDF, full-subtree BFS fetch), a cost roll-up model with
  an unusual-but-confirmed additive rule, column chooser, server+client search.
- **Testing:** four standalone Node scripts (`test-reducer.mjs`, `test-normalizer.mjs`,
  `test-cost.mjs`, `verify-export.mjs`). No test runner, no CI.

## 2. Orcanos QMS AI — `c:\AI Projects\Orcanos QMS`

**Versions:** backend `2.38.4`, frontend `1.38.2` · **Docs:** `CLAUDE.md` (7 KB, routing only) +
`MD files/` (`START_HERE.md`, `SYSTEM.md`, `ARCHITECTURE.md`, `PATTERNS.md`, `UI.md`,
`COMPLIANCE.md`, `SCHEMA.md`, `SECURITY_FIXES.md`), `design/README.md` (index of 52 pre-build
specs), `user-manual/USER_MANUAL.md` (published to GitBook)

**Also known as "Ask Paul"** — the name it is reached by from traceability-matrix, via an
AES-256-GCM silent-login handoff (`POST /api/auth/ask-paul-sso`).

The largest of the four. A multi-tenant, multi-standard compliance QMS powered by RAG:
indexes ISO compliance documents (27001 / 13485 / 14971) from Google Drive folders, Orcanos
project exports and ZIP uploads, answers natural-language questions through a 2-stage router +
hybrid search, and identifies clause coverage gaps.

- **Stack:** Python 3.11 + FastAPI (NDJSON streaming) · React + Vite frontend · OpenAI
  (`text-embedding-3-small` + GPT-4o) · Supabase (pgvector, auth, settings) · SQL Server
  (Orcanos source DB, read-only).
- **Multi-account SaaS:** each account gets its own Supabase project and SQL Server connection,
  resolved per-request through ContextVars (`backend/account_keys.py`). One-click provisioning
  runs `design/sql/bootstrap_new_account.sql` via the Supabase Management API.
- **Deploy:** GCP Cloud Run + Cloud Build (backend, Dockerfile + `cloudbuild.yaml`), Vercel (frontend).
- **Compliance pipeline:** IEC 62304 requirements live as markdown in `requirements/` with a
  machine-readable `_index.json` carrying Orcanos IDs; `scripts/compliance/` syncs them to Orcanos
  and generates `/docs/`.
- **Skills:** this project is the origin of most of the global skills in `~/.claude/skills/`
  (`orcanos-api`, `orcanos-login`, `orcanos-rag-architecture`, `supabase-patterns`,
  `fastapi-streaming`, `ui-ux`, `gcp-deployment`, the `req-*` family, `orcanos-test-automation`).
  Project-local skills: `gitbook`, `document`.
- **Hard rule carried in its CLAUDE.md:** deployment gate — commit locally, never push or deploy
  without explicit approval.

## 3. Quiz Management — `c:\AI Projects\quiz-management`

**Version:** `0.1.0` · **Docs:** `CLAUDE.md`, `SCHEMA.md`, `DEPLOYMENT.md`, `README.md`

Multi-tenant training-quiz platform. Admins build multiple-choice quizzes, assign them to users
in their organization and review pass/fail history; users take assigned quizzes with auto-saved
progress and capped retries.

- **Stack:** Next.js 16 (App Router, JavaScript) + React 19 + Tailwind 3 + Supabase (Postgres + Auth).
- **Backend:** none of its own. Every page is a client component talking straight to Supabase
  with the anon key. No API routes, no server actions.
- **Tenancy:** `accounts` / `user_accounts` / `user_profiles`; a user can belong to several accounts.
  Route guards are client-side `localStorage` reads and are **cosmetic** — the real boundary is RLS
  in the database (migration `013`).
- **Migrations:** 14 forward-only, idempotent SQL files in `supabase/migrations/`, applied by a
  ledger-backed runner (`.github/scripts/apply-migrations.sh`) from GitHub Actions —
  `staging` branch → staging DB, `main` → production DB (gated on a GitHub environment).
- **Deploy:** Vercel (frontend) + Supabase. `deploy.bat` → staging, `deploy.bat main` → production.
- **Testing:** Playwright E2E; authenticated specs skip cleanly without seeded `E2E_*` credentials.
- **Maturity:** the least mature of the four. Its CLAUDE.md carries 13 "Critical Implementation
  Notes" — several still-open (orphaned `/admin/invite`, sign-up redirect broken, `/master` route
  missing, quiz history hard-deleted on quiz delete).

## 4. Traceability Matrix — `c:\AI Projects\traceability-matrix`

**Version:** `3.28.3` · **Docs:** `CLAUDE.md` (~23 KB — orientation and indexes only),
`docs/notes/` (the 33 Critical Implementation Notes, six files by area), `docs/FILE_MAP.md`,
`docs/API.md`, `docs/changelog/`, `ARCHITECTURE.md`, `SCHEMA.md`, `SECURITY.md`,
`user-manual/` (GitBook). Still the deepest documentation of the four — but since 2026-08-29
only `CLAUDE.md` is loaded into a session; everything else is read on demand.

Multi-level traceability generator over Orcanos. Builds requirement-to-test chains L1→L6 with
gap detection, per-level project/version/filter configuration, privacy controls, and
Excel/HTML export.

- **Stack:** FastAPI (Python) backend + React frontend + SQLite. Documented target deployment is
  Windows Server IIS.
- **Two panel types share one stack**, switched on `trace_setups.panel_type`:
  - `trace` — the L1→L6 matrix (`matrix_engine.py`), plus coverage funnel, coverage graph,
    Orphan Mode connect canvas, and a Trace Builder (`build_api.py`).
  - `training` — Training Traceability (`training_engine.py`): joins controlled documents and
    formal training records against roles and people, produces a per-person report, funnel,
    printable certificate, and Excel/HTML exports from one cached snapshot.
- **Auth:** proxies Orcanos `qw_login`, then its own httpOnly cookie session + CSRF tokens.
- **AI:** optional. Per-account provider routing (`ai_provider.py`) between Anthropic and an
  Orcanos Bedrock gateway, with cost accounting (`ai_usage.py`). Used for "Describe a panel"
  free-text → panel config, duplicate/link scoring, and item generation. Degrades harmlessly
  with no API key.
- **Skills:** project-local `.claude/skills/` (including `gitbook`) — this directory is on the
  session's additional working directories list.

---

## What the four have in common (the case for consolidating)

1. **Orcanos is the system of record for three of them.** covaris-bom, Orcanos QMS and
   traceability-matrix all authenticate with `QW_Login` and read through
   `QW_Get_Filter_Results` / `QW_Get_Object`. Three separate client implementations exist
   (`src/api/orcanosClient.js`, `backend/api.py`, `src/backend/orcanos_client.py`), each having
   independently rediscovered the same quirks — Basic auth with an empty body, XML-wrapped
   arrays, `Display_text` vs `Text` on picklists, the `"46584 (42195)"` id shape, CORS requiring
   a proxy. The `orcanos-api` skill is the shared write-up; the code is not shared.
2. **Two independent auth models.** Orcanos credentials (covaris-bom, traceability-matrix,
   parts of Orcanos QMS) vs Supabase Auth (quiz-management, Orcanos QMS accounts). Any merged
   platform has to pick a session model or bridge the two.
3. **Two independent multi-tenancy models.** Orcanos QMS provisions a Supabase project per
   account and routes per-request via ContextVars; quiz-management uses one Postgres with RLS
   keyed off `auth.uid()`.
4. **Four deployment targets:** Vercel static (covaris-bom), Cloud Run + Vercel (Orcanos QMS),
   Vercel + Supabase + GitHub Actions migrations (quiz-management), Windows IIS + SQLite
   (traceability-matrix).
5. **Three frontend stacks:** React+Vite (×2), Next.js App Router (×1), plus one CRA-era React
   (traceability-matrix). All four aim at the same Orcanos design system (the `ui-ux` skill,
   purple `#5C35A8` / orange `#F5A623` / Inter).
6. **Overlapping domain surface.** quiz-management's training quizzes and
   traceability-matrix's Training Traceability panel model the *same compliance obligation* —
   who has been trained on what — from two ends (delivering training vs evidencing it).
   That is the most obvious merge candidate.

## Open questions for the consolidation (not yet decided)

- Monorepo with per-app packages, or one application absorbing the others?
- Single sign-on: Orcanos credentials, Supabase Auth, or Supabase fronting an Orcanos check?
- One shared Orcanos client (which language? Python backend, or a JS client per frontend)?
- Where does SQLite-on-IIS go — is traceability-matrix ported to Postgres/Supabase, or kept
  on-prem as a deployment variant?
- Version and release strategy across four projects that currently version independently.

---

## Working rules inherited from the source projects

These are carried over because they will apply to any consolidated code:

- **Deployment gate.** Commit locally; do not `git push`, deploy, or trigger Cloud Build without
  explicit approval. In covaris-bom and quiz-management a push *is* a deploy.
- **No permission-asking on routine, reversible work** — edits, tests, local verification,
  investigation follow-ups. Just do it and report.
- **Release management.** Every shippable change bumps the version and prepends a
  `release_notes.json` entry (covaris-bom, Orcanos QMS). Never put customer data in release notes.
- **Requirements traceability** (Orcanos QMS): after a deploy touching `backend/` or
  `frontend/src/`, run `/req-trace` on modified files and `/req-create` for new behavior.
- **Design system over ad-hoc CSS.** Tokens from the `ui-ux` skill; no MUI/AntD/shadcn.
