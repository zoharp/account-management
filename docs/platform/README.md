# `docs/platform/` — wider than this app

Three documents that are **not about `account-management` specifically**. They describe the
platform the four Orcanos projects are being consolidated into, and they live here because this
repo is the consolidation's first landing point — and because the folder above it is not a git
repo, so anything left there was tracked by nothing.

They moved in on 2026-08-29 from `c:\AI Projects\compliance-platform\`. Links inside the repo that
used to read `../PLATFORM_AUTH.md` now read `docs/platform/PLATFORM_AUTH.md`.

| Document | What it is | Read it |
|---|---|---|
| [`PLATFORM_AUTH.md`](PLATFORM_AUTH.md) | **As-built.** How authentication actually works across all five projects — the master `users` table, the shared HS256 JWT, where `QW_Login` is and isn't used — plus the proposal to add tenant membership and fold Orcanos login into one session model. §5 carries the decisions taken 2026-08-28 | Before touching `lib/session.ts`, `lib/login.ts` or anything under `api/auth/` |
| [`PLATFORM_MODULES_PROPOSAL.md`](PLATFORM_MODULES_PROPOSAL.md) | **Proposal — nothing implemented.** The module portal: per-module licensing, and adding Training Management to traceability-matrix as a module rather than a panel type. §3.3 and D4 depend on `PLATFORM_AUTH.md`. Its intended destination is the `traceability-matrix` repo, not this one | Consolidation and licensing questions |
| [`SOURCE_PROJECTS.md`](SOURCE_PROJECTS.md) | **Reference snapshot.** What each of the four source projects is, how it is built, what they have in common, and the consolidation questions still open. Was the workspace `CLAUDE.md` | Getting oriented across the four projects |

## A caution about the last one

`SOURCE_PROJECTS.md` describes four codebases that are **not in this repo** and that change
independently of it. Versions, file paths and doc layouts in it go stale the moment one of those
projects ships. Treat it as a map, not an authority: each project's own `CLAUDE.md` is the source
of truth for its codebase, and is what you should check before acting on anything read here.
