param(
    [string]$ProjectRoot = $PSScriptRoot,
    [string]$Email = "yajibsoftware@gmail.com"
)

$ErrorActionPreference = "Stop"

function SecureToPlain([Security.SecureString]$Secure) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
}

Write-Host ""
Write-Host "=== KEDCO LOCAL CLOUD - ADMIN PASSWORD RECOVERY v3 ===" -ForegroundColor Cyan

$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$UsersFile   = Join-Path $ProjectRoot "cloud data\system\users.json"
$BackupDir   = Join-Path $ProjectRoot "cloud data\backups"
$AuditDir    = Join-Path $ProjectRoot "cloud data\audit"
$AuditFile   = Join-Path $AuditDir "events.jsonl"

if (-not (Test-Path $UsersFile)) {
    throw "Local users file not found: $UsersFile"
}

$Node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $Node) {
    throw "Node.js was not found. Run: node --version"
}

# Build a temporary JS helper instead of node -e.
# This avoids Windows PowerShell 5.1 quoting/parsing problems.
$TempJs = Join-Path $env:TEMP ("kedco-password-recovery-" + [guid]::NewGuid().ToString("N") + ".js")

$Js = @'
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function loadUsers(file) {
  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const parsed = JSON.parse(raw);

  if (Array.isArray(parsed)) {
    return { root: parsed, users: parsed, wrapped: false };
  }

  if (parsed && Array.isArray(parsed.users)) {
    return { root: parsed, users: parsed.users, wrapped: true };
  }

  throw new Error("Unsupported users.json format. Expected [] or { users: [] }.");
}

function saveUsers(file, loaded) {
  const temp = file + ".tmp-" + process.pid;
  fs.writeFileSync(temp, JSON.stringify(loaded.root, null, 2), "utf8");
  fs.renameSync(temp, file);
}

const mode = process.argv[2];
const file = process.argv[3];

if (!mode || !file) {
  throw new Error("Missing mode or users file.");
}

const loaded = loadUsers(file);
const users = loaded.users;

if (mode === "list") {
  console.log("USER_COUNT=" + users.length);
  for (const u of users) {
    console.log([
      String(u.email || ""),
      String(u.full_name || u.name || ""),
      String(u.primary_role || u.role || ""),
      u.is_active === false ? "false" : "true"
    ].join("\t"));
  }
  process.exit(0);
}

if (mode !== "reset") {
  throw new Error("Unknown mode: " + mode);
}

const email = String(process.argv[4] || "").trim().toLowerCase();
const password = String(process.env.KEDCO_NEW_LOCAL_PASSWORD || "");

if (!email) throw new Error("Email is required.");
if (password.length < 8) throw new Error("Password must be at least 8 characters.");

const index = users.findIndex(
  u => String(u.email || "").trim().toLowerCase() === email
);

if (index < 0) {
  throw new Error("Local user not found: " + email);
}

// Match the KEDCO Local Cloud backend password format:
// 16-byte hex salt + scrypt(password, salt-buffer, 64-byte key).
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync(
  password,
  Buffer.from(salt, "hex"),
  64
).toString("hex");

users[index].password_salt = salt;
users[index].password_hash = hash;
users[index].updated_at = new Date().toISOString();

saveUsers(file, loaded);

console.log("RESET_OK=" + String(users[index].email || email));
'@

Set-Content -Path $TempJs -Value $Js -Encoding UTF8

try {
    Write-Host ""
    Write-Host "Reading local users from:" -ForegroundColor DarkGray
    Write-Host "  $UsersFile" -ForegroundColor DarkGray

    $List = & node.exe $TempJs list $UsersFile 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw ($List -join "`n")
    }

    Write-Host ""
    Write-Host "Existing Local Cloud users:" -ForegroundColor Yellow

    $countLine = $List | Where-Object { $_ -match '^USER_COUNT=' } | Select-Object -First 1
    $rows = @($List | Where-Object { $_ -notmatch '^USER_COUNT=' })

    foreach ($row in $rows) {
        $parts = ([string]$row) -split "`t", 4
        if ($parts.Count -ge 1) {
            $e = $parts[0]
            $n = if ($parts.Count -ge 2) { $parts[1] } else { "" }
            $r = if ($parts.Count -ge 3) { $parts[2] } else { "" }
            $a = if ($parts.Count -ge 4) { $parts[3] } else { "" }
            Write-Host ("  {0,-36} {1,-28} {2,-18} active={3}" -f $e,$n,$r,$a)
        }
    }

    Write-Host ""
    Write-Host $countLine -ForegroundColor Green

    if ([string]::IsNullOrWhiteSpace($Email)) {
        $Email = Read-Host "Email whose LOCAL password should be reset"
    } else {
        $confirmEmail = Read-Host "Reset LOCAL password for $Email ? (Y/N)"
        if ($confirmEmail.Trim().ToUpperInvariant() -ne "Y") {
            $Email = Read-Host "Enter the LOCAL user email to reset"
        }
    }

    $Email = $Email.Trim().ToLowerInvariant()

    while ($true) {
        $s1 = Read-Host "Create new LOCAL password (minimum 8 characters)" -AsSecureString
        $s2 = Read-Host "Confirm new LOCAL password" -AsSecureString

        $p1 = SecureToPlain $s1
        $p2 = SecureToPlain $s2

        if ($p1.Length -lt 8) {
            Write-Host "Password must be at least 8 characters." -ForegroundColor Yellow
            continue
        }

        if ($p1 -ne $p2) {
            Write-Host "Passwords do not match. Try again." -ForegroundColor Yellow
            continue
        }

        break
    }

    New-Item -ItemType Directory -Force $BackupDir | Out-Null
    New-Item -ItemType Directory -Force $AuditDir | Out-Null

    $Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $BackupFile = Join-Path $BackupDir "users-before-password-reset-$Stamp.json"
    Copy-Item $UsersFile $BackupFile -Force

    $env:KEDCO_NEW_LOCAL_PASSWORD = $p1

    $Reset = & node.exe $TempJs reset $UsersFile $Email 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw ($Reset -join "`n")
    }

    if (($Reset -join "`n") -notmatch '^RESET_OK=') {
        throw "Password reset did not report success."
    }

    $Audit = [ordered]@{
        id        = [guid]::NewGuid().ToString()
        timestamp = (Get-Date).ToUniversalTime().ToString("o")
        type      = "LOCAL_PASSWORD_RECOVERED_OFFLINE_V3"
        email     = $Email
    } | ConvertTo-Json -Compress

    Add-Content -Path $AuditFile -Value $Audit -Encoding UTF8

    Write-Host ""
    Write-Host "SUCCESS: Local password reset completed." -ForegroundColor Green
    Write-Host "User:   $Email" -ForegroundColor Green
    Write-Host "Backup: $BackupFile" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "No other local users, roles, routing, eForms, uploads, Analyzer data, Daily Logs or Load Flow records were changed." -ForegroundColor Cyan
}
finally {
    Remove-Item Env:KEDCO_NEW_LOCAL_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item $TempJs -Force -ErrorAction SilentlyContinue
    Remove-Variable p1,p2,s1,s2 -ErrorAction SilentlyContinue
}
