$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Source = Join-Path $Root "cloud data"
$DestDir = Join-Path $Root "local-backups"
if (-not (Test-Path $Source)) { throw "cloud data folder was not found: $Source" }
New-Item -ItemType Directory -Force $DestDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$zip = Join-Path $DestDir "KEDCO-CloudData-$stamp.zip"
Write-Host "Backing up local KEDCO data..." -ForegroundColor Cyan
Compress-Archive -Path (Join-Path $Source '*') -DestinationPath $zip -CompressionLevel Optimal
Write-Host "Backup created:" -ForegroundColor Green
Write-Host $zip
