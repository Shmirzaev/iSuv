[CmdletBinding()]
param(
  [string]$EnvFile = '.env',
  [string]$ApiBaseUrl = 'http://127.0.0.1:3000',
  [switch]$AllowServiceInterruption
)

$ErrorActionPreference = 'Stop'

if (-not $AllowServiceInterruption) {
  throw 'This smoke test briefly stops only the local Compose PostgreSQL service. Re-run with -AllowServiceInterruption to acknowledge the interruption.'
}
if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
  throw "Environment file '$EnvFile' was not found."
}

function Get-ReadyStatus {
  try {
    return (Invoke-WebRequest -UseBasicParsing -Uri "$ApiBaseUrl/health/ready" -TimeoutSec 5).StatusCode
  } catch {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    throw
  }
}

try {
  $before = Get-ReadyStatus
  if ($before -ne 200) { throw "Expected readiness 200 before degradation, got $before." }

  & docker compose --env-file $EnvFile stop postgres
  if ($LASTEXITCODE -ne 0) { throw 'Could not stop the local PostgreSQL service.' }
  Start-Sleep -Seconds 1
  $degraded = Get-ReadyStatus
  if ($degraded -ne 503) { throw "Expected readiness 503 while PostgreSQL is stopped, got $degraded." }
} finally {
  & docker compose --env-file $EnvFile start postgres
  if ($LASTEXITCODE -ne 0) { throw 'Could not restart the local PostgreSQL service.' }
}

$deadline = (Get-Date).AddSeconds(45)
do {
  Start-Sleep -Milliseconds 750
  $recovered = Get-ReadyStatus
} until ($recovered -eq 200 -or (Get-Date) -ge $deadline)
if ($recovered -ne 200) { throw "Expected readiness recovery to 200, got $recovered." }
Write-Host 'Readiness degradation and recovery verified (200 -> 503 -> 200).'
