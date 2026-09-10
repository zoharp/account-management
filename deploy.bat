@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ========================================
echo  DEPLOY  -  account-management
echo ========================================
echo.
echo  Vercel auto-deploys this repo on push to main.
echo  A PUSH IS A PRODUCTION DEPLOY.
echo.
REM Nothing below asks a question. Running this script is the approval, and
REM typecheck + build are what protect production. It only stops - and waits -
REM when something has actually failed.
REM   deploy.bat                      commits as "Deploy <date> <time>"
REM   deploy.bat "Fix audit filter"   commits with that message

REM ── [1/7] Dependencies ──────────────────────────────────────────────
echo === [1/7] Checking dependencies ===
if not exist "node_modules" (
    call npm install --no-audit --no-fund
    if errorlevel 1 ( echo npm install FAILED - nothing deployed. & pause & exit /b 1 )
) else (
    echo Already installed.
)
echo.

REM ── [2/6] Typecheck ─────────────────────────────────────────────────
REM Catch it here rather than in a red Vercel build.
echo === [2/7] Typecheck ===
call npx tsc --noEmit
if errorlevel 1 ( echo Typecheck FAILED - nothing deployed. & pause & exit /b 1 )
echo Typecheck OK.
echo.

REM ── [3/7] Production build ──────────────────────────────────────────
echo === [3/7] Production build ===
call npx next build
if errorlevel 1 ( echo Build FAILED - nothing deployed. & pause & exit /b 1 )
echo.

REM ── [4/7] Master DB migrations ──────────────────────────────────────
REM Apply any sql/NNN_*.sql not yet recorded in schema_migrations on the
REM master Supabase, via the Management API (the only route that works
REM for master DDL - see CLAUDE.md). Ledger-backed and idempotent, so a
REM repeat deploy with nothing pending is a fast no-op. Fails the deploy
REM if a migration errors: better to stop here than push code that
REM expects a column that is not there.
echo === [4/7] Master DB migrations ===
call node scripts/apply-master-migrations.mjs
if errorlevel 1 ( echo Master migrations FAILED - nothing deployed. & pause & exit /b 1 )
echo.

REM ── [5/7] Tenant DB migrations ──────────────────────────────────────
REM For every account in master, re-apply sql/bootstrap_new_account.sql
REM to that tenant's Supabase project if its per-tenant schema_migrations
REM ledger does not carry the current file's hash. The bootstrap file is
REM idempotent (create ... if not exists), so re-runs are safe; the hash
REM ledger just skips the work when nothing changed. A failing tenant is
REM reported per-line and fails the deploy at the end.
echo === [5/7] Tenant DB migrations ===
call node scripts/apply-tenant-migrations.mjs
if errorlevel 1 ( echo Tenant migrations FAILED - nothing deployed. & pause & exit /b 1 )
echo.

REM ── [6/7] Commit ────────────────────────────────────────────────────
REM Nothing is asked. The message is whatever was passed on the command line
REM (deploy.bat "Fix the audit filter"), else "Deploy <date> <time>" — a real
REM message is a thing you write in a commit, not at a prompt that blocks a
REM deploy you already decided to run.
echo === [6/7] Commit ===
set "MSG=%~1"
if "!MSG!"=="" set "MSG=Deploy %DATE% %TIME:~0,5%"
git add -A
git status --short
git diff --cached --quiet
if errorlevel 1 (
    echo Committing: !MSG!
    git commit -m "!MSG!"
    if errorlevel 1 ( echo Commit failed. & pause & exit /b 1 )
) else (
    echo Nothing to commit - current commit will be deployed.
)
echo.

REM ── [7/7] Push ──────────────────────────────────────────────────────
REM No confirmation prompt: running this script IS the approval. The build
REM gates above are what protect production, not a typed word.
echo === [7/7] Push to GitHub ^(deploys to production^) ===
echo.
git log -1 --oneline
echo.

git rev-parse --abbrev-ref --symbolic-full-name @{u} >nul 2>&1
if errorlevel 1 (
    echo First push - setting upstream...
    git push -u origin main
    if errorlevel 1 ( echo Push FAILED. & pause & exit /b 1 )
    goto :pushed
)

REM Someone else may have pushed since you last pulled - another machine, or
REM a Claude cloud session. Git refuses a non-fast-forward push because
REM completing it would erase their commits. Catch that HERE, with the repo
REM in a known state, instead of as a raw "[rejected] (fetch first)".
echo Fetching remote...
git fetch origin
if errorlevel 1 ( echo Fetch FAILED - check the network or your credentials. & pause & exit /b 1 )

set BEHIND=0
for /f %%i in ('git rev-list --count HEAD..origin/main') do set BEHIND=%%i

if not "!BEHIND!"=="0" (
    echo.
    echo Remote has !BEHIND! commit^(s^) you do not have locally:
    git log --format="   %%h  %%an  %%s" HEAD..origin/main
    echo.
    echo Rebasing your work on top of them...
    git pull --rebase --autostash
    if errorlevel 1 (
        git rebase --abort >nul 2>&1
        git stash pop >nul 2>&1
        echo.
        echo ========================================
        echo  REBASE CONFLICT - nothing was pushed.
        echo.
        echo  Your commits and theirs touch the same lines. Resolve it by
        echo  hand, then run this script again:
        echo.
        echo     git pull --rebase
        echo     ^<fix the conflicted files^>
        echo     git add -A ^&^& git rebase --continue
        echo.
        echo  Version files ^(package.json, release_notes.json, the
        echo  changelog^) conflict whenever both sides shipped a release.
        echo  Keep BOTH release notes and renumber yours upward.
        echo ========================================
        pause
        exit /b 1
    )
    echo.
    echo Rebased. Re-checking, because what you are about to deploy
    echo is no longer what was built above.
    call npx tsc --noEmit
    if errorlevel 1 ( echo Typecheck FAILED after rebase - nothing deployed. & pause & exit /b 1 )
    call npx next build
    if errorlevel 1 ( echo Build FAILED after rebase - nothing deployed. & pause & exit /b 1 )
    call node scripts/apply-master-migrations.mjs
    if errorlevel 1 ( echo Master migrations FAILED after rebase - nothing deployed. & pause & exit /b 1 )
    call node scripts/apply-tenant-migrations.mjs
    if errorlevel 1 ( echo Tenant migrations FAILED after rebase - nothing deployed. & pause & exit /b 1 )
    echo.
)

git push
if errorlevel 1 ( echo Push FAILED. & pause & exit /b 1 )

:pushed

echo.
echo ========================================
echo  Pushed. Vercel is building now.
echo.
echo  Watch it:   https://vercel.com/dashboard
echo.
echo  Reminder - the Vercel project needs every variable from
echo  .env.example set for Production, and the production
echo  /auth/callback URL added to the Google / Microsoft
echo  OAuth client, or sign-in will fail.
echo ========================================
echo.
REM Not a prompt - the window just stays up long enough to read. It closes on
REM its own, or on any key. Only FAILURES pause and wait, because those you
REM have to read.
timeout /t 20
