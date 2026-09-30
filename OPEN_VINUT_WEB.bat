@echo off
setlocal EnableExtensions

title Vinut 3D Showcase - Web Server

rem Always run from this batch file's directory, including paths with spaces.
cd /d "%~dp0"

if not exist "package.json" (
  echo [ERROR] package.json was not found.
  echo Make sure this file is inside the Vinut project root.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found in PATH.
  echo Install Node.js LTS, reopen the terminal, then run this file again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [INFO] node_modules is missing. Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

echo [INFO] Starting Vinut 3D Showcase at http://127.0.0.1:3000/
start "Vinut 3D Showcase Server" cmd /k "npm run dev -- --hostname 127.0.0.1"

rem Give Next.js a moment to start before opening the browser.
timeout /t 4 /nobreak >nul
start "" "http://127.0.0.1:3000/"

echo [OK] Browser opened. Keep the server window open while using the website.
endlocal
