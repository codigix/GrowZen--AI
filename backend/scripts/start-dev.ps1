# Starts the GrowZen backend the safe way for this setup (database on another server through an SSH tunnel).
#   1. stops any backend already on port 8000, including its reloader (two copies on one port make every page load forever)
#   2. starts the SSH tunnel to the database when port 5433 is not open, with keep-alives so it notices when the link drops
#   3. starts ONE backend
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File D:\projects\GrowZen--AI\backend\scripts\start-dev.ps1
$ErrorActionPreference = "Stop"
$backend = Split-Path -Parent $PSScriptRoot

# 1. one backend only
$ids = @(Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
foreach ($id in $ids) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$id"
  $top = $id
  while ($p -and $p.ParentProcessId) {                       # climb to the uvicorn reloader that started it
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)"
    if ($parent -and $parent.CommandLine -match "uvicorn") { $top = $parent.ProcessId; $p = $parent } else { break }
  }
  Write-Host "Stopping the backend on port 8000 (process $top)"
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
Write-Host "Starting the backend on http://0.0.0.0:8000"
& "$backend\.venv\Scripts\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
