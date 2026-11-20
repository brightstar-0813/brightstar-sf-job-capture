# Create or repair the Python venv used by the SimplyHired helper
# (scripts/simplyhired_fetch.py). Only curl_cffi is required.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root ".venv-jobspy"
$py = Join-Path $venv "Scripts\python.exe"

if (-not (Test-Path $py)) {
  Write-Host "Creating venv at $venv"
  $base = (Get-Command py -ErrorAction SilentlyContinue)
  if ($base) { & py -3 -m venv $venv } else { & python -m venv $venv }
}

& $py -m pip install --upgrade pip --quiet
& $py -m pip install --upgrade curl_cffi --quiet
& $py -c "import curl_cffi; print('curl_cffi', curl_cffi.__version__, 'OK')"
Write-Host "PYTHON_BIN default: $py"
