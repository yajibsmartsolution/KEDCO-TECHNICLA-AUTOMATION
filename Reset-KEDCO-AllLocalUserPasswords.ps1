param(
    [string]$ProjectRoot = $PSScriptRoot
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
Write-Host "=== KEDCO LOCAL CLOUD - RESET ALL USER PASSWORDS ===" -ForegroundColor Cyan

$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$UsersFile   = Join-Path $ProjectRoot "cloud data\system\users.json"
$BackupDir   = Join-Path $ProjectRoot "cloud data\backups"
$AuditDir    = Join-Path $ProjectRoot "cloud data\audit"
$AuditFile   = Join-Path $AuditDir "events.jsonl"

if (-not (Test-Path $UsersFile)) {
    throw "Local users file not found: $UsersFile"
}

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    throw "Node.js was not found in PATH. Run: node --version"
}

$TempJs = Join-Path $env:TEMP ("kedco-reset-all-passwords-" + [guid]::NewGuid().ToString("N") + ".js")

$Js = @'
const fs = require("fs");
const crypto = require("crypto");

function loadUsers(file) {
  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const parsed = JSON.parse(raw);

  if (Array.isArray(parsed)) {
    return { root: parsed, users: parsed };
  }

  if (parsed && Array.isArray(parsed.users)) {
    return { root: parsed, users: parsed.users };
  }

  throw new Error("Unsupported users.json format. Expected [] or { users: [] }.");
}

const mode = process.argv[2];
const file = process.argv[3];

if (!mode || !file) throw new Error("Missing mode or users file.");

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

if (mode !== "reset-all") throw new Error("Unknown mode: " + mode);

const password = String(process.env.KEDCO_SHARED_LOCAL_PASSWORD || "");
if (password.length < 8) throw new Error("Password must be at least 8 characters.");

let changed = 0;

for (const u of users) {
  // Every account gets its own fresh salt, even though the password is shared.
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(
    password,
    Buffer.from(salt, "hex"),
    64
  ).toString("hex");

  u.password_salt = salt;
  u.password_hash = hash;
  u.updated_at = new Date().toISOString();
  changed++;
}

const temp = file + ".tmp-" + process.pid;
fs.writeFileSync(temp, JSON.stringify(loaded.root, null, 2), "utf8");
fs.renameSync(temp, file);

console.log("RESET_ALL_OK=" + changed);
'@

Set-Content -Path $TempJs -Value $Js -Encoding UTF8

try {
    Write-Host ""
    Write-Host "Reading Local Cloud users..." -ForegroundColor Yellow

    $List = & node.exe $TempJs list $UsersFile 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw ($List -join "`n")
    }

    $CountLine = $List | Where-Object { $_ -match '^USER_COUNT=' } | Select-Object -First 1
    $Rows = @($List | Where-Object { $_ -notmatch '^USER_COUNT=' })

    Write-Host ""
    foreach ($row in $Rows) {
        $parts = ([string]$row) -split "`t", 4
        $email = if ($parts.Count -ge 1) { $parts[0] } else { "" }
        $name  = if ($parts.Count -ge 2) { $parts[1] } else { "" }
        $role  = if ($parts.Count -ge 3) { $parts[2] } else { "" }
        Write-Host ("  {0,-38} {1,-28} {2}" -f $email,$name,$role)
    }

    Write-Host ""
    Write-Host $CountLine -ForegroundColor Green

    $Confirm = Read-Host "Set ONE SHARED LOCAL password for ALL listed users? (Y/N)"
    if ($Confirm.Trim().ToUpperInvariant() -ne "Y") {
        Write-Host "Cancelled. No passwords were changed." -ForegroundColor Yellow
        exit 0
    }

    while ($true) {
        $S1 = Read-Host "Enter the new shared LOCAL password (minimum 8 characters)" -AsSecureString
        $S2 = Read-Host "Confirm the shared LOCAL password" -AsSecureString

        $P1 = SecureToPlain $S1
        $P2 = SecureToPlain $S2

        if ($P1.Length -lt 8) {
            Write-Host "Password must be at least 8 characters." -ForegroundColor Yellow
            continue
        }

        if ($P1 -ne $P2) {
            Write-Host "Passwords do not match. Try again." -ForegroundColor Yellow
            continue
        }

        break
    }

    New-Item -ItemType Directory -Force $BackupDir | Out-Null
    New-Item -ItemType Directory -Force $AuditDir | Out-Null

    $Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $BackupFile = Join-Path $BackupDir "users-before-reset-all-passwords-$Stamp.json"
    Copy-Item $UsersFile $BackupFile -Force

    $env:KEDCO_SHARED_LOCAL_PASSWORD = $P1

    $Reset = & node.exe $TempJs reset-all $UsersFile 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw ($Reset -join "`n")
    }

    $ResetLine = $Reset | Where-Object { $_ -match '^RESET_ALL_OK=' } | Select-Object -First 1
    if (-not $ResetLine) {
        throw "Password reset did not report success."
    }

    $Changed = ($ResetLine -replace '^RESET_ALL_OK=','')

    $Audit = [ordered]@{
        id            = [guid]::NewGuid().ToString()
        timestamp     = (Get-Date).ToUniversalTime().ToString("o")
        type          = "LOCAL_ALL_USER_PASSWORDS_RESET"
        users_changed = [int]$Changed
    } | ConvertTo-Json -Compress

    Add-Content -Path $AuditFile -Value $Audit -Encoding UTF8

    Write-Host ""
    Write-Host "SUCCESS: Shared Local Cloud password applied." -ForegroundColor Green
    Write-Host "Users updated: $Changed" -ForegroundColor Green
    Write-Host "Backup: $BackupFile" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "Each account kept its own email, role, routing and permissions." -ForegroundColor Cyan
    Write-Host "Only the login password was made the same." -ForegroundColor Cyan
}
finally {
    Remove-Item Env:KEDCO_SHARED_LOCAL_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item $TempJs -Force -ErrorAction SilentlyContinue
    Remove-Variable P1,P2,S1,S2 -ErrorAction SilentlyContinue
}
