param(
    [string]$ApiBase = "http://127.0.0.1:3000"
)

$ErrorActionPreference = "Stop"

function Convert-SecureToPlain([Security.SecureString]$Secure) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

Write-Host "`n=== KEDCO LOCAL CLOUD - FIRST ADMIN SETUP ===" -ForegroundColor Cyan

try {
    $status = Invoke-RestMethod -Uri "$ApiBase/api/auth/setup-status" -Method Get -TimeoutSec 5
} catch {
    Write-Host "Local backend is not reachable at $ApiBase." -ForegroundColor Red
    Write-Host "Run .\Start-KEDCO-Local.ps1 first, then run this setup again." -ForegroundColor Yellow
    exit 1
}

if (-not $status.setup_required) {
    Write-Host "Local authentication is already initialized ($($status.users) user(s)). No changes were made." -ForegroundColor Green
    Write-Host "If you cannot remember the LOCAL password, stop the backend and run:" -ForegroundColor Yellow
    Write-Host "  .\Reset-KEDCO-LocalAdminPassword.ps1" -ForegroundColor Cyan
    exit 0
}

$answer = Read-Host "Create the FIRST local SUPER_ADMIN/DEVELOPER account now? (Y/N)"
if ($answer -notmatch '^(Y|YES)$') {
    Write-Host "Cancelled. No account was created." -ForegroundColor Yellow
    exit 0
}

$email = (Read-Host "Administrator email").Trim().ToLowerInvariant()
if ($email -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') { throw "Enter a valid email address." }
$fullName = (Read-Host "Administrator full name").Trim()
if (-not $fullName) { $fullName = "KEDCO Local Administrator" }

while ($true) {
    $secure1 = Read-Host "Create local password (minimum 8 characters)" -AsSecureString
    $secure2 = Read-Host "Confirm local password" -AsSecureString
    $plain1 = Convert-SecureToPlain $secure1
    $plain2 = Convert-SecureToPlain $secure2
    if ($plain1.Length -lt 8) {
        Write-Host "Password must contain at least 8 characters." -ForegroundColor Yellow
        continue
    }
    if ($plain1 -ne $plain2) {
        Write-Host "Passwords do not match. Try again." -ForegroundColor Yellow
        continue
    }
    break
}

try {
    $payload = @{ email = $email; password = $plain1; full_name = $fullName } | ConvertTo-Json
    $result = Invoke-RestMethod -Uri "$ApiBase/api/auth/setup" -Method Post -ContentType "application/json" -Body $payload
    Write-Host "`nLocal administrator created successfully." -ForegroundColor Green
    Write-Host "Email: $($result.user.email)"
    Write-Host "Roles: SUPER_ADMIN, DEVELOPER"
    Write-Host "The password was not written to this script or displayed." -ForegroundColor DarkGray
} finally {
    Remove-Variable plain1, plain2, secure1, secure2 -ErrorAction SilentlyContinue
}
