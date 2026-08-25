# Register a Windows Scheduled Task to run capture every 8 hours (local time).
#   npm run schedule:install
# or:
#   powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$taskName = "DiceJobCapture_Every8Hours"
$legacyTaskNames = @(
  "DiceJobCapture_5am5pm",
  "DiceJobCapture_Every12Hours"
)

$nodeCandidates = @(
  "$env:LOCALAPPDATA\nvm\v20.12.2\node.exe",
  "$env:LOCALAPPDATA\nvm\v20.19.0\node.exe",
  "$env:ProgramFiles\nodejs\node.exe"
)
$cmd = Get-Command node -ErrorAction SilentlyContinue
if ($cmd) { $nodeCandidates += $cmd.Source }

$nodeExe = $nodeCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $nodeExe) {
  throw "node.exe not found. Install Node 20 / nvm first."
}

Write-Host "Using node: $nodeExe"
Write-Host "Working dir: $root"

$action = New-ScheduledTaskAction `
  -Execute $nodeExe `
  -Argument "src\capture.js" `
  -WorkingDirectory $root

# Fixed local times matching CRON_SCHEDULE=0 */8 * * * (12 AM, 8 AM, 4 PM)
$trigger0 = New-ScheduledTaskTrigger -Daily -At "12:00AM"
$trigger8 = New-ScheduledTaskTrigger -Daily -At "8:00AM"
$trigger16 = New-ScheduledTaskTrigger -Daily -At "4:00PM"

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew

# Run whether the user is logged on or not (S4U = no stored password needed).
$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType S4U `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger @($trigger0, $trigger8, $trigger16) `
  -Settings $settings `
  -Principal $principal `
  -Description "Capture remote Salesforce jobs every 8 hours (12 AM, 8 AM, 4 PM local)" `
  -Force | Out-Null

foreach ($legacyTaskName in $legacyTaskNames) {
  $legacy = Get-ScheduledTask -TaskName $legacyTaskName -ErrorAction SilentlyContinue
  if ($legacy) {
    Unregister-ScheduledTask -TaskName $legacyTaskName -Confirm:$false
    Write-Host "Removed legacy task '$legacyTaskName'."
  }
}

Write-Host "Scheduled task '$taskName' installed (every 8 hours: 12 AM, 8 AM, 4 PM local)."
Write-Host "Run now:  Start-ScheduledTask -TaskName '$taskName'"
Write-Host "JobRight: use Chrome extension + API autostart (npm run schedule:api)"
