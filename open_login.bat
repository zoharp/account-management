@echo off
REM ────────────────────────────────────────────────────────────────
REM  Opens the account-management login screen.
REM  Starts the dev server first if it isn't already running on 3100.
REM  Double-click this file. That's the whole thing.
REM ────────────────────────────────────────────────────────────────

cd /d "%~dp0"

netstat -ano | findstr ":3100" | findstr "LISTENING" >nul
if errorlevel 1 (
    echo Server not running - starting it...
    start "Account Management Dev Server" cmd /k "call npm run dev"
    echo Waiting for it to come up...
    timeout /t 6 /nobreak >nul
) else (
    echo Server already running on port 3100.
)

echo Opening http://localhost:3100/login ...
start http://localhost:3100/login
