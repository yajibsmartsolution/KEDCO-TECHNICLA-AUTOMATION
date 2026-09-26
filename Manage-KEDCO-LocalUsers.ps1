param([string]$ApiBase = "http://127.0.0.1:3000")
$ErrorActionPreference = "Stop"

$Roles = @(
"CTO","SUPER_ADMIN","DEVELOPER","MD_CEO","HEAD_TECHNICAL","TA_CTO","HEAD_SO","DISPATCH_SUPERVISOR","DISPATCH","OPERATOR","TCN_INTERFACE","STATION_OPERATOR","HEAD_OM","REGIONAL_OM_COORD","TSP_TECH_SERVICES","REGIONAL_EF_LEAD","REGIONAL_CJ_LEAD","REGIONAL_EF","REGIONAL_CJ","RE","TE","HEAD_PCM","REGIONAL_PCM_COORD","PROTECTION_ENGINEER","CONTROL_SCADA_ENGINEER","METERING_ENGINEER","TEST_ENGINEER","REGIONAL_PPM_COORD","HEAD_PI","REGIONAL_PI_COORD","PLANNING_ENGINEER","PROJECT_ENGINEER","HEAD_HSE","REGIONAL_HSE_OFFICER","HSE_OFFICER","HEAD_MIS","MIS_TEAM_LEAD","DATA_ANALYST","PROCUREMENT_HEAD","PROCUREMENT_OFFICER","FINANCE_HEAD","FINANCE_OFFICER","LEGAL_OFFICER","SECURITY_OFFICER","HR_ADMIN_OFFICER","TMO","ANALYZER","TRANSMISSION","STORE_MANAGER","STORE_OFFICER","CONTRACTOR_PM","CONTRACTOR_USER"
)

function Plain([Security.SecureString]$s) { $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try {[Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)} }
function Invoke-LocalApi([string]$Path,[string]$Method="GET",$Body=$null) {
    $headers=@{ Authorization="Bearer $script:Token" }
    $params=@{ Uri="$ApiBase$Path"; Method=$Method; Headers=$headers; TimeoutSec=10 }
    if($null -ne $Body){$params.ContentType="application/json";$params.Body=($Body|ConvertTo-Json -Depth 10)}
    Invoke-RestMethod @params
}

Write-Host "`n=== KEDCO LOCAL USER MANAGER ===" -ForegroundColor Cyan
$email=(Read-Host "Administrator email").Trim().ToLowerInvariant()
$secure=Read-Host "Administrator password" -AsSecureString
$password=Plain $secure
try {
    $login=Invoke-RestMethod -Uri "$ApiBase/api/auth/login" -Method Post -ContentType "application/json" -Body (@{email=$email;password=$password}|ConvertTo-Json)
    $script:Token=$login.session.access_token
} finally { Remove-Variable password,secure -ErrorAction SilentlyContinue }
if(-not $script:Token){throw "Login failed."}

while($true){
    Write-Host "`n1. List local users"
    Write-Host "2. Create local user"
    Write-Host "3. Reset local user password"
    Write-Host "4. Set a local user's authorized station assignment(s)"
    Write-Host "5. Exit"
    $choice=Read-Host "Choose"
    if($choice -eq '1'){
        $out=Invoke-LocalApi '/api/auth/local-users'
        $out.users | Select-Object email,full_name,primary_role,@{N='roles';E={$_.roles -join ','}},@{N='stations';E={($_.assignments -join '; ')}},is_active | Format-Table -AutoSize
    } elseif($choice -eq '2'){
        $newEmail=(Read-Host 'New user email').Trim().ToLowerInvariant()
        $name=(Read-Host 'Full name').Trim()
        Write-Host "Available role codes:`n$($Roles -join ', ')" -ForegroundColor DarkGray
        $roleText=(Read-Host 'Role code(s), comma separated').ToUpperInvariant()
        $roleList=@($roleText.Split(',')|ForEach-Object{$_.Trim()}|Where-Object{$_})
        $unknown=@($roleList|Where-Object{$_ -notin $Roles})
        if($unknown.Count){Write-Host "Unknown role(s): $($unknown -join ', ')" -ForegroundColor Red;continue}
        $primary=(Read-Host "Primary role [$($roleList[0])]").Trim().ToUpperInvariant();if(-not $primary){$primary=$roleList[0]}
        if($primary -notin $roleList){Write-Host 'Primary role must be assigned to the user.' -ForegroundColor Red;continue}
        $s1=Read-Host 'Create password' -AsSecureString;$s2=Read-Host 'Confirm password' -AsSecureString;$p1=Plain $s1;$p2=Plain $s2
        try {
            if($p1.Length -lt 8){Write-Host 'Password must be at least 8 characters.' -ForegroundColor Red;continue}
            if($p1 -ne $p2){Write-Host 'Passwords do not match.' -ForegroundColor Red;continue}
            $out=Invoke-LocalApi '/api/auth/local-users' 'POST' @{email=$newEmail;full_name=$name;password=$p1;roles=$roleList;primary_role=$primary}
            Write-Host "Created $($out.user.email)" -ForegroundColor Green
        } finally {Remove-Variable p1,p2,s1,s2 -ErrorAction SilentlyContinue}
    } elseif($choice -eq '3'){
        $target=(Read-Host 'User email').Trim().ToLowerInvariant();$s1=Read-Host 'New password' -AsSecureString;$s2=Read-Host 'Confirm password' -AsSecureString;$p1=Plain $s1;$p2=Plain $s2
        try {if($p1.Length -lt 8){Write-Host 'Password must be at least 8 characters.' -ForegroundColor Red;continue};if($p1 -ne $p2){Write-Host 'Passwords do not match.' -ForegroundColor Red;continue};Invoke-LocalApi '/api/auth/local-users/password' 'POST' @{email=$target;password=$p1}|Out-Null;Write-Host 'Password updated.' -ForegroundColor Green} finally {Remove-Variable p1,p2,s1,s2 -ErrorAction SilentlyContinue}
    } elseif($choice -eq '4'){
        $out=Invoke-LocalApi '/api/auth/local-users'
        $out.users | Select-Object email,full_name,primary_role,@{N='stations';E={($_.assignments -join '; ')}} | Format-Table -AutoSize
        $targetEmail=(Read-Host 'User email to update').Trim().ToLowerInvariant()
        $target=$out.users | Where-Object { $_.email -eq $targetEmail } | Select-Object -First 1
        if(-not $target){Write-Host 'Local user not found.' -ForegroundColor Red;continue}
        $stationText=Read-Host 'Authorized station names, comma-separated (blank clears assignments)'
        $assignments=@($stationText.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
        $result=Invoke-LocalApi "/api/admin/users/$([uri]::EscapeDataString([string]$target.id))/assignments" 'POST' @{assignments=$assignments}
        Write-Host "Saved $($result.user.assignments.Count) station assignment(s) for $($result.user.email). Ask the user to sign out and back in." -ForegroundColor Green
    } elseif($choice -eq '5'){break}
}
