param([string]$ApiBase = "http://127.0.0.1:3000")
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Tool = Join-Path $Root "tools\kedco-local-selftest.mjs"

Write-Host "`n=== KEDCO LOCAL CLOUD - FUNCTIONAL SELF-TEST ===" -ForegroundColor Cyan
if (-not (Test-Path $Tool)) { throw "Self-test tool was not found: $Tool" }
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw "Node.js is not available in PATH." }
try {
    $health = Invoke-RestMethod -Uri "$ApiBase/health" -Method Get -TimeoutSec 5
    if (-not $health.ok -or $health.storage_mode -ne "local") { throw "The backend is not running in Local Cloud mode." }
} catch {
    throw "KEDCO Local Cloud is not reachable at $ApiBase. Run .\Start-KEDCO-Local.ps1 first. $($_.Exception.Message)"
}

$email = (Read-Host "Local administrator email").Trim().ToLowerInvariant()
$secure = Read-Host "Local administrator password" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    $env:KEDCO_TEST_ROOT = $Root
    $env:KEDCO_TEST_BASE = $ApiBase
    $env:KEDCO_TEST_EMAIL = $email
    $env:KEDCO_TEST_PASSWORD = $plain
    & node.exe $Tool
    $code = $LASTEXITCODE
    if ($code -ne 0) { throw "One or more Local Cloud functional checks failed." }
    Write-Host "`nAll Local Cloud functional self-tests passed." -ForegroundColor Green
    Write-Host "Temporary test records/files were cleaned automatically." -ForegroundColor DarkGray
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    Remove-Variable plain, secure -ErrorAction SilentlyContinue
    Remove-Item Env:KEDCO_TEST_ROOT, Env:KEDCO_TEST_BASE, Env:KEDCO_TEST_EMAIL, Env:KEDCO_TEST_PASSWORD -ErrorAction SilentlyContinue
}
