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

REM ── [5/5] Push (gated) ──────────────────────────────────────────────
echo === [5/5] Push to GitHub ^(deploys to production^) ===
echo.
git log -1 --oneline
echo.
set /p CONFIRM="Type DEPLOY to push to production, anything else to stop: "
if /i not "!CONFIRM!"=="DEPLOY" (
    echo.
    echo Stopped. Commit is local only - nothing was pushed or deployed.
    pause
    exit /b 0
)

echo.
git rev-parse --abbrev-ref --symbolic-full-name @{u} >nul 2>&1
if errorlevel 1 (
    echo First push - setting upstream...
    git push -u origin main
) else (
    git push
)
if errorlevel 1 ( echo Push FAILED. & pause & exit /b 1 )

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
