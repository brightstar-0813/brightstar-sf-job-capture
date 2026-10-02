# Install both:
#  1) Capture at 5 AM and 5 PM local, every day
#  2) Local API at Windows logon (for JobRight extension ingest)
#
#   npm run schedule:install

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot

& "$here\install-scheduler.ps1"
& "$here\install-api-autostart.ps1"

Write-Host ""
Write-Host "All set:"
Write-Host "  - DiceJobCapture_5am5pm       (capture at 5 AM and 5 PM)"
Write-Host "  - DiceJobCapture_API_AtLogon   (npm start equivalent at login)"
Write-Host "Keep Chrome signed in to JobRight; extension runs at 5 AM and 5 PM while Chrome is open."
