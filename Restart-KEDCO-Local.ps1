param([switch]$OpenBrowser, [switch]$SkipBuild)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PidFile = Join-Path $Root "cloud data\system\backend.pid"
$StartScript = Join-Path $Root "Start-KEDCO-Local.ps1"
function Get-KedcoBackendProcess([int]$ProcessId) {
    $info = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    if (-not $info) { return $null }
    $projectPath = $Root -replace '/', '\\'
    $isProjectProcess = ([string]$info.CommandLine).IndexOf($projectPath, [StringComparison]::OrdinalIgnoreCase) -ge 0
    $isBackendEntry = [string]$info.CommandLine -match '(?i)(?:dist[\\/]+server\.js|src[\\/]+server\.ts)'
    if ($info.Name -ine "node.exe" -or -not $isProjectProcess -or -not $isBackendEntry) { throw "PID $ProcessId does not match the KEDCO backend command and was left running." }
    return $info
}
$targets = @{}
if (Test-Path $PidFile) { $value = Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1; if ($value -match '^\d+$') { $info = Get-KedcoBackendProcess ([int]$value); if ($info) { $targets[[string]$info.ProcessId] = [int]$info.ProcessId } } }
try { $listenerIds = @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique) } catch { $listenerIds = @() }
foreach ($listenerId in $listenerIds) { $info = Get-KedcoBackendProcess ([int]$listenerId); if ($info) { $targets[[string]$info.ProcessId] = [int]$info.ProcessId } }
$backendPath = Join-Path $Root "backend"
$backendProcesses = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -ieq "node.exe" -and ([string]$_.CommandLine).IndexOf($backendPath, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.CommandLine -match '(?i)(?:dist[\\/]+server\.js|src[\\/]+server\.ts)' })
foreach ($backendProcess in $backendProcesses) { $targets[[string]$backendProcess.ProcessId] = [int]$backendProcess.ProcessId }
$processIds = @($targets.Values | Sort-Object -Unique)
$backendParentIds = @()
foreach ($backendProcess in $backendProcesses) { if (@($backendProcesses | Where-Object { $_.ParentProcessId -eq $backendProcess.ProcessId }).Count) { $backendParentIds += [int]$backendProcess.ProcessId } }
$stopOrder = @($backendParentIds) + @($processIds | Where-Object { $_ -notin $backendParentIds })
foreach ($processId in ($stopOrder | Select-Object -Unique)) { Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue }
if ($processIds.Count) {
    Write-Host "Stopped KEDCO backend process(es): $($processIds -join ', ')" -ForegroundColor DarkGray
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    do { $stillRunning = @($processIds | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }); if (-not $stillRunning.Count) { break }; Start-Sleep -Milliseconds 100 } while ([DateTime]::UtcNow -lt $deadline)
    if ($stillRunning.Count) { throw "KEDCO backend process(es) did not stop: $($stillRunning -join ', ')" }
}
$deadline = [DateTime]::UtcNow.AddSeconds(5)
do { try { $stillListening = @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction Stop) } catch { $stillListening = @() }; if (-not $stillListening.Count) { break }; Start-Sleep -Milliseconds 100 } while ([DateTime]::UtcNow -lt $deadline)
if ($stillListening.Count) { throw "Port 3000 is still listening; no replacement backend was started." }
Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
$startArgs = @{}
if (-not $OpenBrowser) { $startArgs.NoBrowser = $true }
if ($SkipBuild) { $startArgs.SkipBuild = $true }
& $StartScript @startArgs
