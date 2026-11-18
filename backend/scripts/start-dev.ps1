# Starts the GrowZen backend the safe way for this setup (database on another server through an SSH tunnel).
#   1. stops any backend already on port 8000 or on the port in backend\.env (PUBLIC_BASE_URL), including its reloader (two copies make every page load forever)
#   2. starts the SSH tunnel to the database when port 5433 is not open, with keep-alives so it notices when the link drops
#   3. starts ONE backend
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File D:\projects\GrowZen--AI\backend\scripts\start-dev.ps1
$ErrorActionPreference = "Stop"
$backend = Split-Path -Parent $PSScriptRoot

# The port the app is configured for: the one in PUBLIC_BASE_URL (backend\.env), which the frontend's VITE_API_URL and the Google sign-in address must match. 8000 when it names none.
$port = 8000
$envFile = Join-Path $backend ".env"
if (Test-Path $envFile) {
  $line = Get-Content $envFile | Where-Object { $_ -match '^\s*PUBLIC_BASE_URL\s*=' } | Select-Object -First 1
  if ($line -match ':(\d+)\s*/?\s*$') { $port = [int]$Matches[1] }
}

# 1. one backend only
$ids = @(Get-NetTCPConnection -LocalPort ($port, 8000 | Select-Object -Unique) -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
foreach ($id in $ids) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$id"
  $top = $id
  while ($p -and $p.ParentProcessId) {                       # climb to the uvicorn reloader that started it
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)"
    if ($parent -and $parent.CommandLine -match "uvicorn") { $top = $parent.ProcessId; $p = $parent } else { break }
  }
  Write-Host "Stopping the backend on its port (process $top)"
  & taskkill /F /T /PID $top | Out-Null
}
Start-Sleep -Seconds 2

# 2. the database tunnel
if (-not (Get-NetTCPConnection -LocalPort 5433 -State Listen -ErrorAction SilentlyContinue)) {
  Write-Host "Starting the SSH tunnel to the database"
  Start-Process ssh -ArgumentList "-N", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3", "-o", "ExitOnForwardFailure=yes", "-L", "5433:localhost:5432", "root@31.97.206.36" -WindowStyle Minimized
  Start-Sleep -Seconds 4
} else { Write-Host "The database tunnel is already open (port 5433)" }

# 3. one backend
Set-Location $backend
Write-Host "Starting the backend on http://0.0.0.0:$port"
& "$backend\.venv\Scripts\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port $port --reload
