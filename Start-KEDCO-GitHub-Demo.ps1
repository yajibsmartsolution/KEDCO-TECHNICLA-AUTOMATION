param([switch]$SkipBuild)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Tunnel = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $Tunnel) {
    throw "cloudflared is not installed or not on PATH. Install Cloudflare Tunnel, then reopen PowerShell and retry."
}

try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:3000/health" -Method Get -TimeoutSec 2
    if ($health.ok) {
        throw "KEDCO backend is already running with its previous CORS settings. Run .\Stop-KEDCO-Local.ps1, then retry this script."
    }
} catch {
    if ($_.Exception.Message -like "KEDCO backend is already running*") { throw }
}

$previousCorsOrigin = $env:CORS_ORIGIN
$env:CORS_ORIGIN = "https://yajibsmartsolution.github.io,http://localhost:3000,http://localhost:5500,http://127.0.0.1:3000,http://127.0.0.1:5500"
try {
    & (Join-Path $Root "Start-KEDCO-Local.ps1") -NoBrowser -SkipBuild:$SkipBuild

    Write-Host "`nStarting a temporary public HTTPS tunnel to the local backend." -ForegroundColor Cyan
    Write-Host "Keep this window open and copy the https://....trycloudflare.com URL printed below." -ForegroundColor Yellow
    Write-Host "Set GITHUB_PAGES_API_BASE in frontend/supabase-config.js to that URL, then commit and push the change."
    & $Tunnel.Source tunnel --no-autoupdate --url "http://127.0.0.1:3000"
} finally {
    if ($null -eq $previousCorsOrigin) { Remove-Item Env:CORS_ORIGIN -ErrorAction SilentlyContinue }
    else { $env:CORS_ORIGIN = $previousCorsOrigin }
}