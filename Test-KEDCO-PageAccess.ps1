$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Base = 'http://127.0.0.1:3000'
Write-Host "`n=== KEDCO LOCAL PAGE ACCESS TEST ===" -ForegroundColor Cyan
try { $health = Invoke-RestMethod "$Base/health" -TimeoutSec 5 } catch { throw "Backend is not reachable on port 3000. Run .\Start-KEDCO-Local.ps1 first. $($_.Exception.Message)" }
if (-not $health.ok -or $health.storage_mode -ne 'local') { throw 'Port 3000 is not the KEDCO Local Storage backend.' }
Write-Host "Backend: OK / local" -ForegroundColor Green
$routes = @(
'/', '/index.html','/local-access-diagnostic.html',
'/pages/developer/dev.html','/pages/executive/cto.html','/pages/executive/ta.html',
'/pages/system-operations/headso.html','/pages/system-operations/dispatch.html','/pages/system-operations/operator.html',
'/pages/operations-maintenance/headom.html','/pages/operations-maintenance/re_te.html','/pages/operations-maintenance/regionalef.html','/pages/operations-maintenance/regionalcj.html',
'/pages/pcm/headpcm.html','/pages/pcm/regionalpcm.html','/pages/planning-investment/headpi.html','/pages/planning-investment/regionalpi.html',
'/pages/hse/headhse.html','/pages/hse/regionalhse.html','/pages/mis/mis.html','/pages/mis/teamleaddata.html',
'/pages/tmo/tmo.html','/pages/tmo/analyzer.html','/pages/tmo/trans.html','/pages/stores/store-inventory.html','/pages/contractors/contractors.html'
)
$fail = @()
foreach($route in $routes){
  try { $r=Invoke-WebRequest ($Base+$route) -UseBasicParsing -TimeoutSec 8; if($r.StatusCode -ne 200){$fail += "$route -> $($r.StatusCode)"} }
  catch { $fail += "$route -> $($_.Exception.Message)" }
}
if($fail.Count){ Write-Host "Page failures:" -ForegroundColor Red; $fail | ForEach-Object { Write-Host "  $_" }; exit 1 }
Write-Host "All $($routes.Count) key page URLs returned HTTP 200." -ForegroundColor Green
Write-Host "Open: $Base/local-access-diagnostic.html" -ForegroundColor Cyan
