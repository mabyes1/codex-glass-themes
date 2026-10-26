$ErrorActionPreference='Stop'
$repository=Split-Path -Parent $PSScriptRoot
$root=Join-Path ([IO.Path]::GetTempPath()) ('glass-repair-'+[guid]::NewGuid().ToString('N'))
$children=@()
function Get-ScheduledTask {param($TaskName,$ErrorAction);return $null}
try{
    New-Item -ItemType Directory -Path (Join-Path $root 'theme') -Force|Out-Null
    $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    @{product='CodexGlassThemes';sid=$sid;root=$root;mode='Install';version='2.0.0'}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $root 'installation.json') -Encoding UTF8
    $hostScript=Join-Path $root 'theme\theme-host.mjs'
    [IO.File]::WriteAllText($hostScript,'setInterval(()=>{},1000);')
    [IO.File]::WriteAllText((Join-Path $root 'Start-Theme-Auto.ps1'),'# original watcher')
    [IO.File]::WriteAllText((Join-Path $root 'Setup-Theme.ps1'),'# original setup')
    $unrelated=Join-Path $root 'unrelated.mjs';[IO.File]::WriteAllText($unrelated,'setInterval(()=>{},1000);')
    $node=(Get-Command node.exe).Source
    for($i=0;$i -lt 3;$i++){$children+=Start-Process -FilePath $node -ArgumentList @(('"'+$hostScript+'"')) -WindowStyle Hidden -PassThru}
    $other=Start-Process -FilePath $node -ArgumentList @(('"'+$unrelated+'"')) -WindowStyle Hidden -PassThru;$children+=$other
    $repair=Join-Path $repository 'scripts\Repair-ThemeHelpers.ps1'
    $plan=& $repair -InstallRoot $root -CheckOnly|ConvertFrom-Json
    if($plan.processes.Count -ne 3){throw 'Repair inventory missed duplicate helpers'}
    $result=& $repair -InstallRoot $root -NoRestart|ConvertFrom-Json
    if(!$result.ok -or $result.helpersBefore -ne 3){throw 'Repair failed'}
    foreach($child in $children[0..2]){$child.Refresh();if(!$child.HasExited){throw 'A duplicate helper survived'}}
    $other.Refresh();if($other.HasExited){throw 'Unrelated Node process was stopped'}
    if([IO.File]::ReadAllText((Join-Path $result.backup 'theme\theme-host.mjs')) -ne 'setInterval(()=>{},1000);'){throw 'Old helper was not backed up'}
    foreach($relative in @('Start-Theme-Auto.ps1','Get-ThemeHelperProcess.ps1','Setup-Theme.ps1','theme\theme-host.mjs','theme\host-lease.mjs','theme\token-feed.mjs')){
        if([IO.File]::ReadAllText((Join-Path $root $relative)) -ne [IO.File]::ReadAllText((Join-Path $repository ('packaging\payload\'+$relative)))){throw ('Repair copy differs: '+$relative)}
    }
    $owner=Get-Content -LiteralPath (Join-Path $root 'installation.json') -Raw|ConvertFrom-Json
    $owner.sid='wrong-account';$owner|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $root 'installation.json') -Encoding UTF8
    $rejected=$false;try{& $repair -InstallRoot $root -CheckOnly|Out-Null}catch{$rejected=$true}
    if(!$rejected){throw 'Foreign installation was accepted'}
    Write-Output 'PASS: inventory, three duplicate helpers removed, unrelated process preserved, backup, patch files, wrong account rejected'
}finally{
    foreach($child in $children){$child.Refresh();if(!$child.HasExited){$child.Kill();$child.WaitForExit()};$child.Dispose()}
    if([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($root)) -ne [IO.Path]::GetTempPath().TrimEnd('\')){throw 'Cleanup escaped temp directory'}
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
