param(
    [string]$ProjectRoot = $PSScriptRoot,
    [switch]$KeepUsers
)

$ErrorActionPreference = "Stop"

Write-Host "`n=== KEDCO LOCAL CLOUD - SAFE RESET ===" -ForegroundColor Cyan
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$Cloud = Join-Path $ProjectRoot "cloud data"
$BackupDir = Join-Path $ProjectRoot "local-backups"
$StopScript = Join-Path $ProjectRoot "Stop-KEDCO-Local.ps1"

if (-not (Test-Path $Cloud)) { throw "cloud data folder was not found: $Cloud" }
Write-Host "Project: $ProjectRoot"
Write-Host "Data:    $Cloud"
Write-Host "`nThis resets local KEDCO records only. It does not connect to external services." -ForegroundColor Yellow
Write-Host "A complete backup ZIP will be created first." -ForegroundColor Green
if ($KeepUsers) { Write-Host "Local users will be preserved because -KeepUsers was supplied." -ForegroundColor Yellow }
else { Write-Host "Local users/passwords will also be reset. A new administrator must be initialized afterward." -ForegroundColor Yellow }

$confirm = Read-Host "Type RESET LOCAL CLOUD to continue"
if ($confirm -cne "RESET LOCAL CLOUD") {
    Write-Host "Cancelled. No data was changed." -ForegroundColor Yellow
    exit 0
}

# Stop only this project's local backend if the supplied stop helper exists.
if (Test-Path $StopScript) {
    try { & $StopScript -Force 2>$null } catch { }
}

New-Item -ItemType Directory -Force $BackupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$zip = Join-Path $BackupDir "KEDCO-CloudData-BEFORE-RESET-$stamp.zip"
Write-Host "Creating backup..." -ForegroundColor Cyan
Compress-Archive -Path (Join-Path $Cloud '*') -DestinationPath $zip -CompressionLevel Optimal -Force
Write-Host "Backup created: $zip" -ForegroundColor Green

$preservedUsers = $null
if ($KeepUsers) {
    $usersFile = Join-Path $Cloud "system\users.json"
    if (Test-Path $usersFile) { $preservedUsers = Get-Content $usersFile -Raw }
}

# Clear operational/test data but preserve the directory itself and README.
$clearDirs = @(
    "tables", "snapshots", "load-flow", "operations", "workflows", "files", "registry", "audit"
)
foreach ($rel in $clearDirs) {
    $dir = Join-Path $Cloud $rel
    if (Test-Path $dir) { Get-ChildItem $dir -Force | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue }
}

# Recreate canonical Local Cloud layout.
$dirs = @(
    "system", "tables", "snapshots", "load-flow\33kv", "load-flow\11kv", "operations\daily",
    "workflows", "files\kedco-evidence", "files\kedco-workflow-files", "registry", "audit", "backups"
)
foreach ($rel in $dirs) { New-Item -ItemType Directory -Force (Join-Path $Cloud $rel) | Out-Null }

if ($KeepUsers -and $null -ne $preservedUsers) {
    Set-Content -Path (Join-Path $Cloud "system\users.json") -Value $preservedUsers -Encoding UTF8
} else {
    Set-Content -Path (Join-Path $Cloud "system\users.json") -Value "[]" -Encoding UTF8
}
Set-Content -Path (Join-Path $Cloud "system\sessions.json") -Value "[]" -Encoding UTF8
@'
{
  "version": 0,
  "updated_at": "1970-01-01T00:00:00.000Z"
}
'@ | Set-Content -Path (Join-Path $Cloud "system\version.json") -Encoding UTF8

$readme = Join-Path $Cloud "README.txt"
if (-not (Test-Path $readme)) {
@'
KEDCO TECHNICAL AUTOMATION - LOCAL CLOUD DATA

This folder is the persistent local KEDCO data store.
Do not delete it while local mode is in use.
The application writes JSON data, workflow records, load-flow history and uploaded evidence here.
Application records, workflow data and uploaded evidence remain on this computer.
'@ | Set-Content -Path $readme -Encoding UTF8
}

Write-Host "`nLOCAL CLOUD RESET COMPLETE." -ForegroundColor Green
Write-Host "Operational records, eForms, uploads, Analyzer archive, Daily Log and 33/11 kV readings are now clean." -ForegroundColor Green
if (-not $KeepUsers) {
    Write-Host "Run .\Start-KEDCO-Local.ps1 and create the first administrator when prompted." -ForegroundColor Cyan
}
Write-Host "No external service was accessed." -ForegroundColor DarkGray
