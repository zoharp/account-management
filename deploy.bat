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

REM ── [1/5] Dependencies ──────────────────────────────────────────────
echo === [1/5] Checking dependencies ===
if not exist "node_modules" (
    call npm install --no-audit --no-fund
    if errorlevel 1 ( echo npm install FAILED - nothing deployed. & pause & exit /b 1 )
) else (
    echo Already installed.
)
echo.

REM ── [2/5] Typecheck ─────────────────────────────────────────────────
REM Catch it here rather than in a red Vercel build.
echo === [2/5] Typecheck ===
call npx tsc --noEmit
if errorlevel 1 ( echo Typecheck FAILED - nothing deployed. & pause & exit /b 1 )
echo Typecheck OK.
echo.

REM ── [3/5] Production build ──────────────────────────────────────────
echo === [3/5] Production build ===
call npx next build
if errorlevel 1 ( echo Build FAILED - nothing deployed. & pause & exit /b 1 )
echo.

REM ── [4/5] Commit ────────────────────────────────────────────────────
echo === [4/5] Commit ===
git add -A
git status --short
git diff --cached --quiet
if errorlevel 1 (
    set /p MSG="Commit message [Deploy]: "
    if "!MSG!"=="" set MSG=Deploy
    git commit -m "!MSG!"
    if errorlevel 1 ( echo Commit failed. & pause & exit /b 1 )
) else (
    echo Nothing to commit - current commit will be deployed.
)
echo.

REM ── [5/5] Push ──────────────────────────────────────────────────────
REM No confirmation prompt: running this script IS the approval. The build
REM gates above are what protect production, not a typed word.
echo === [5/5] Push to GitHub ^(deploys to production^) ===
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
pause
