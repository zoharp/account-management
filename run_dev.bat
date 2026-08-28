@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo ========================================
echo  Orcanos Platform Console
echo  account-management - Development Mode
echo ========================================
echo.

REM ── Free port 3100 ──────────────────────────────────────────────────
echo Cleaning up old processes on port 3100...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3100" ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)

REM ── Environment ─────────────────────────────────────────────────────
REM The app reads every secret at startup. Without .env.local it builds
REM fine and then fails on the first request with a confusing error, so
REM stop here instead.
if not exist ".env.local" (
    echo.
    echo ========================================
    echo  MISSING .env.local
    echo ========================================
    echo.
    echo Creating .env.local from .env.example...
    copy /y ".env.example" ".env.local" >nul
    echo.
    echo Fill it in before running again. These four MUST be copied
    echo VERBATIM from the Orcanos QMS backend .env, or sessions and
    echo stored account secrets will not work:
    echo.
    echo    SUPABASE_URL
    echo    SUPABASE_SERVICE_KEY
    echo    JWT_SECRET
    echo    ENCRYPTION_KEY
    echo.
    echo Then set SUPABASE_ORG_ACCESS_TOKEN and SUPABASE_ORG_ID for
    echo account provisioning.
    echo.
    echo Opening .env.local...
    start "" notepad ".env.local"
    pause
    exit /b 1
)

REM ── Dependencies ────────────────────────────────────────────────────
if not exist "node_modules" (
    echo.
    echo Installing dependencies...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo.
        echo npm install FAILED.
        pause
        exit /b 1
    )
)

REM ── Go ──────────────────────────────────────────────────────────────
echo.
echo ========================================
echo  Starting on http://localhost:3100
echo ========================================
echo.
echo  Sign in with an @orcanos.com admin account.
echo  Ctrl+C stops the server.
echo.
echo  First run? Make sure sql\001_account_provisioning.sql has been
echo  applied to the MASTER Supabase, or account creation will fail.
echo.

REM Open the browser once the server has had a moment to boot. The dev
REM server itself runs in the foreground so Ctrl+C works and you can see
REM the request log.
start "" cmd /c "timeout /t 4 /nobreak >nul && start http://localhost:3100"

call npm run dev
