param(
    [switch]$NoBrowser,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $Root "backend"
$Cloud = Join-Path $Root "cloud data"
$SystemDir = Join-Path $Cloud "system"
$PidFile = Join-Path $SystemDir "backend.pid"
$StdOut = Join-Path $SystemDir "backend.log"
$StdErr = Join-Path $SystemDir "backend-error.log"
$HealthUrl = "http://127.0.0.1:3000/health"

Write-Host "`n=== KEDCO TECHNICAL AUTOMATION - LOCAL CLOUD ===" -ForegroundColor Cyan
Write-Host "Project: $Root"
Write-Host "Data:    $Cloud"

if (-not (Test-Path $Backend)) { throw "Backend folder not found: $Backend" }
New-Item -ItemType Directory -Force $SystemDir | Out-Null

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js is not installed or not available in PATH." }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw "npm.cmd is not available in PATH." }

if (-not (Test-Path (Join-Path $Backend "node_modules"))) {
    Write-Host "Backend dependencies are missing." -ForegroundColor Yellow
    $install = Read-Host "Run npm.cmd install now? This downloads packages from npm. (Y/N)"
    if ($install -notmatch '^(Y|YES)$') { throw "Dependencies are required. No files were changed." }
    Push-Location $Backend
    try { npm.cmd install } finally { Pop-Location }
}

if (-not $SkipBuild) {
    $distServer = Join-Path $Backend "dist\server.js"
    $buildInputs = @(
        Get-ChildItem -Path (Join-Path $Backend "src") -Recurse -File -Filter "*.ts"
        Get-Item (Join-Path $Backend "package.json")
        Get-Item (Join-Path $Backend "package-lock.json") -ErrorAction SilentlyContinue
        Get-Item (Join-Path $Backend "tsconfig.json") -ErrorAction SilentlyContinue
    )
    $needsBuild = -not (Test-Path $distServer)
    if (-not $needsBuild) {
        $distTime = (Get-Item $distServer).LastWriteTimeUtc
        $needsBuild = [bool]($buildInputs | Where-Object { $_.LastWriteTimeUtc -gt $distTime })
    }
    if ($needsBuild) {
        Write-Host "Building local backend..." -ForegroundColor Cyan
        Push-Location $Backend
        try { npm.cmd run build } finally { Pop-Location }
    } else {
        Write-Host "Backend build is current; skipping TypeScript build." -ForegroundColor DarkGray
    }
}

$alreadyRunning = $false
try {
    $existing = Invoke-RestMethod -Uri $HealthUrl -Method Get -TimeoutSec 2
    if ($existing.ok -and $existing.storage_mode -eq "local") {
        $alreadyRunning = $true
        Write-Host "KEDCO Local Cloud backend is already running." -ForegroundColor Green
    } else {
        throw "Port 3000 is already used by another service. Stop that service before starting KEDCO Local Cloud."
    }
} catch {
    if ($_.Exception.Message -like '*another service*') { throw }
}

if (-not $alreadyRunning) {
    if (-not (Test-Path (Join-Path $Backend "dist\server.js"))) { throw "Build output dist\server.js is missing." }
    Remove-Item $StdOut, $StdErr -Force -ErrorAction SilentlyContinue
    $serverScript = Join-Path $Backend "dist\server.js"
    $proc = Start-Process -FilePath "node.exe" -ArgumentList ([char]34 + $serverScript + [char]34) -WorkingDirectory $Backend -RedirectStandardOutput $StdOut -RedirectStandardError $StdErr -WindowStyle Hidden -PassThru
    Set-Content -Path $PidFile -Value $proc.Id -Encoding ASCII
    Write-Host "Starting backend (PID $($proc.Id))..." -ForegroundColor Cyan

    $healthy = $false
    $startupDeadline = [DateTime]::UtcNow.AddSeconds(20)
    while ([DateTime]::UtcNow -lt $startupDeadline) {
        try {
            $health = Invoke-RestMethod -Uri $HealthUrl -Method Get -TimeoutSec 1
            if ($health.ok -and $health.storage_mode -eq "local") { $healthy = $true; break }
        } catch {}
        if (-not $healthy) { Start-Sleep -Milliseconds 200 }
    }
    if (-not $healthy) {
        Write-Host "Backend did not become healthy. Review:" -ForegroundColor Red
        Write-Host "  $StdErr"
        exit 1
    }
    Write-Host "Backend is healthy." -ForegroundColor Green
}

try {
    $setup = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/auth/setup-status" -Method Get -TimeoutSec 2
    if ($setup.setup_required) {
        Write-Host "`nFirst local administrator has not been created yet." -ForegroundColor Yellow
        $init = Read-Host "Initialize the administrator now? (Y/N)"
        if ($init -match '^(Y|YES)$') {
            & (Join-Path $Root "Initialize-KEDCO-LocalAdmin.ps1")
        } else {
            Write-Host "You can initialize later with .\Initialize-KEDCO-LocalAdmin.ps1" -ForegroundColor Yellow
        }
    }
} catch {
    Write-Host "Could not check local authentication setup: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "`nKEDCO Local Cloud is ready:" -ForegroundColor Green
Write-Host "  http://localhost:3000/"
Write-Host "`nData is stored under:" -ForegroundColor Cyan
Write-Host "  $Cloud"
Write-Host "`nExisting local KEDCO data was preserved." -ForegroundColor DarkGray

if (-not $NoBrowser) { Start-Process "http://localhost:3000/" }
