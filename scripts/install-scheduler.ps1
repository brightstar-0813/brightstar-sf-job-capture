# Register a Windows Scheduled Task to run capture every 8 hours.
#   npm run schedule:install
# or:
#   powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$taskName = "DiceJobCapture_Every8Hours"

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

# Start in 2 minutes, then every 8 hours for ~10 years (Windows rejects infinite MaxValue)
$start = (Get-Date).AddMinutes(2)
$trigger = New-ScheduledTaskTrigger -Once -At $start `
  -RepetitionInterval (New-TimeSpan -Hours 8) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew

# Run whether the user is logged on or not (S4U = no stored password needed).
# The task runs in the background under this account whenever the system is on.
$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType S4U `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "Capture Salesforce jobs from Dice + JobRight (APPLY WITH AUTOFILL only) every 8 hours" `
  -Force | Out-Null

Write-Host "Scheduled task '$taskName' installed (starts ~$start, every 8 hours, runs whether logged on or not)."
Write-Host "Run now:  Start-ScheduledTask -TaskName '$taskName'"
Write-Host "JobRight: use Chrome extension + API autostart (npm run schedule:api)"
