@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [X-Nekama] Node.js 24 or later is required.
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)
node setup.mjs
echo.
pause
