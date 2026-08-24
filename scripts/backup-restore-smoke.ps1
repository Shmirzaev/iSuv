[CmdletBinding()]
param(
  [string]$EnvFile = '.env',
  [string]$BackupPath = (Join-Path (Get-Location) ("tmp/isuv-local-backup-{0}-{1}.dump" -f (Get-Date -Format 'yyyyMMddHHmmss'), [guid]::NewGuid().ToString('N'))),
  [string]$SourceDatabase = '',
  [string]$RestoreDatabase = ("isuv_restore_smoke_{0}" -f (Get-Date -Format 'yyyyMMddHHmmss')),
  [switch]$Cleanup
)

$ErrorActionPreference = 'Stop'

function Assert-PgIdentifier([string]$Value, [string]$Label) {
  if ($Value -notmatch '^[a-z][a-z0-9_]{0,62}$') {
    throw "$Label must be a lowercase PostgreSQL identifier (letter first, 63 characters maximum)."
  }
}

function Invoke-Compose([string[]]$ComposeArguments) {
  & docker compose --env-file $EnvFile @ComposeArguments
  if ($LASTEXITCODE -ne 0) { throw "docker compose failed: $($ComposeArguments -join ' ')" }
}

function Invoke-Psql([string]$Database, [string]$Sql) {
  $result = & docker compose --env-file $EnvFile exec -T postgres psql -X -v ON_ERROR_STOP=1 -U $postgresUser -d $Database -At -F '|' -c $Sql
  if ($LASTEXITCODE -ne 0) { throw "psql verification failed for database '$Database'." }
  $line = $result | Where-Object { $_ -match '\S' } | Select-Object -Last 1
  if ($null -eq $line) { return '' }
  return $line.Trim()
}

if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
  throw "Environment file '$EnvFile' was not found. Copy .env.example to .env and set a local-only password."
}

Assert-PgIdentifier $RestoreDatabase 'RestoreDatabase'
Invoke-Compose @('up', '-d', 'postgres')

$postgresUser = (& docker compose --env-file $EnvFile exec -T postgres printenv POSTGRES_USER).Trim()
$configuredSourceDatabase = (& docker compose --env-file $EnvFile exec -T postgres printenv POSTGRES_DB).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Could not read PostgreSQL Compose environment.' }
Assert-PgIdentifier $postgresUser 'POSTGRES_USER'
if (-not $SourceDatabase) { $SourceDatabase = $configuredSourceDatabase }
Assert-PgIdentifier $SourceDatabase 'SourceDatabase'
if ($RestoreDatabase -eq $SourceDatabase) { throw 'RestoreDatabase must differ from SourceDatabase.' }

$migrationDirectory = Join-Path $PSScriptRoot '../apps/api/migrations'
$expectedMigrationNames = (Get-ChildItem -LiteralPath $migrationDirectory -Filter '*.sql' -File | Sort-Object Name | ForEach-Object Name) -join ','
$sourceMigrationNames = Invoke-Psql $SourceDatabase "SELECT coalesce(string_agg(name, ',' ORDER BY name),'') FROM app_schema_migrations;"
if ($sourceMigrationNames -ne $expectedMigrationNames) {
  throw "Source database '$SourceDatabase' does not match the repository migration history. Run migrations before taking a verified backup."
}

$existing = Invoke-Psql 'postgres' "SELECT 1 FROM pg_database WHERE datname = '$RestoreDatabase';"
if ($existing -eq '1') {
  throw "Refusing to replace existing database '$RestoreDatabase'. Choose a new name or inspect/remove it manually."
}

$backupDirectory = Split-Path -Parent $BackupPath
if ($backupDirectory) { New-Item -ItemType Directory -Force -Path $backupDirectory | Out-Null }
$backupPathResolved = [System.IO.Path]::GetFullPath($BackupPath)
if (Test-Path -LiteralPath $backupPathResolved) {
  throw "Refusing to overwrite existing backup '$backupPathResolved'. Choose a new BackupPath."
}
$artifactName = "isuv-backup-$([guid]::NewGuid().ToString('N')).dump"
$containerId = (& docker compose --env-file $EnvFile ps -q postgres).Trim()
if ($LASTEXITCODE -ne 0 -or -not $containerId) { throw 'PostgreSQL container is not running.' }
# Docker Desktop does not expose a container tmpfs to `docker cp`; use a unique,
# short-lived file in the already explicit local PostgreSQL volume instead.
$containerArtifact = "/var/lib/postgresql/data/$artifactName"
$createdRestoreDatabase = $false

# The snapshot is produced by pg_dump inside the container and copied byte-for-byte;
# PowerShell never pipes the custom-format archive through its text pipeline.
try {
  & docker compose --env-file $EnvFile exec -T postgres pg_dump -U $postgresUser -d $sourceDatabase -Fc -f $containerArtifact
  if ($LASTEXITCODE -ne 0) { throw "pg_dump failed for '$sourceDatabase'." }
  & docker cp "${containerId}:$containerArtifact" $backupPathResolved
  if ($LASTEXITCODE -ne 0) { throw "Could not copy backup to '$backupPathResolved'." }

  $sourceFingerprint = Invoke-Psql $sourceDatabase @'
SELECT (SELECT count(*) FROM app_schema_migrations) || '|' ||
       (SELECT count(*) FROM monitoring_stations WHERE data_classification = 'synthetic') || '|' ||
       (SELECT count(*) FROM telemetry_devices WHERE data_classification = 'synthetic') || '|' ||
       (SELECT count(*) FROM audit_events) || '|' ||
       (SELECT md5(coalesce(string_agg(id::text || ':' || request_id || ':' || occurred_at::text, '|' ORDER BY id), '')) FROM audit_events);
'@
  $sourceParts = $sourceFingerprint.Split('|')
  if ($sourceParts.Count -ne 5 -or $sourceParts[1] -ne '83' -or $sourceParts[2] -ne '83') {
    throw "Source verification failed: expected 83 synthetic stations and devices, got '$sourceFingerprint'."
  }

  Invoke-Psql 'postgres' "CREATE DATABASE $RestoreDatabase TEMPLATE template0;" | Out-Null
  $createdRestoreDatabase = $true
  & docker cp $backupPathResolved "${containerId}:$containerArtifact"
  if ($LASTEXITCODE -ne 0) { throw "Could not copy backup into PostgreSQL container." }
  & docker compose --env-file $EnvFile exec -T postgres pg_restore -U $postgresUser -d $RestoreDatabase --exit-on-error $containerArtifact
  if ($LASTEXITCODE -ne 0) { throw "pg_restore failed for '$RestoreDatabase'." }

  $restoredFingerprint = Invoke-Psql $RestoreDatabase @'
SELECT (SELECT count(*) FROM app_schema_migrations) || '|' ||
       (SELECT count(*) FROM monitoring_stations WHERE data_classification = 'synthetic') || '|' ||
       (SELECT count(*) FROM telemetry_devices WHERE data_classification = 'synthetic') || '|' ||
       (SELECT count(*) FROM audit_events) || '|' ||
       (SELECT md5(coalesce(string_agg(id::text || ':' || request_id || ':' || occurred_at::text, '|' ORDER BY id), '')) FROM audit_events);
'@
  if ($restoredFingerprint -ne $sourceFingerprint) {
    throw "Restore verification mismatch. source='$sourceFingerprint' restored='$restoredFingerprint'."
  }

  Write-Host "Backup and restore verified. archive=$backupPathResolved restoreDatabase=$RestoreDatabase fingerprint=$restoredFingerprint"
} finally {
  & docker compose --env-file $EnvFile exec -T postgres rm -f $containerArtifact 2>$null | Out-Null
  if ($Cleanup -and $createdRestoreDatabase) {
    Invoke-Psql 'postgres' "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$RestoreDatabase' AND pid <> pg_backend_pid();" | Out-Null
    Invoke-Psql 'postgres' "DROP DATABASE $RestoreDatabase;" | Out-Null
    Write-Host "Removed only the explicitly selected restore database '$RestoreDatabase'."
  } elseif ($createdRestoreDatabase) {
    Write-Host "Retained restore database '$RestoreDatabase' for inspection. Re-run with -Cleanup to remove only that database."
  }
}
