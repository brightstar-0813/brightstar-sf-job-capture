@echo off
REM Dice + JobRight Salesforce capture (for Windows Task Scheduler)
cd /d "%~dp0.."
call nvm use 20 >nul 2>&1
where node >nul 2>&1
if errorlevel 1 (
  echo node not found in PATH
  exit /b 1
)
node src\capture.js
exit /b %ERRORLEVEL%
