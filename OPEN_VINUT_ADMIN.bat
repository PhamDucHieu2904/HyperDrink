@echo off
setlocal EnableExtensions
title VINUT Admin
cd /d "%~dp0"
if not exist "package.json" (
  echo [ERROR] Open this file from the VINUT project folder.
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install Node.js LTS and reopen this file.
  pause
  exit /b 1
)
if not exist "node_modules\next" (
  echo [INFO] Installing project dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] Installation failed.
    pause
    exit /b 1
  )
)
node scripts\dev-admin.cjs --open
if errorlevel 1 (
  echo [ERROR] Admin could not start. See the message above.
  pause
  exit /b 1
)
endlocal
