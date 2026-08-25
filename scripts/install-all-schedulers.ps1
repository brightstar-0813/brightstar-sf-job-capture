# Install both:
#  1) Capture every 8 hours (12 AM, 8 AM, 4 PM local)
#  2) Local API at Windows logon (for JobRight extension ingest)
#
#   npm run schedule:install

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot

& "$here\install-scheduler.ps1"
& "$here\install-api-autostart.ps1"

Write-Host ""
Write-Host "All set:"
Write-Host "  - DiceJobCapture_Every8Hours   (capture every 8 hours)"
Write-Host "  - DiceJobCapture_API_AtLogon   (npm start equivalent at login)"
Write-Host "Keep Chrome signed in to JobRight; extension runs every 8 hours while Chrome is open."
