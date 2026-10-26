$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\packaging\payload\Get-ThemeHelperProcess.ps1')
$root=Join-Path ([IO.Path]::GetTempPath()) ('glass-watcher-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root|Out-Null
$scriptPath=Join-Path $root 'slow helper.mjs'
$pidFile=Join-Path $root 'host.pid'
[IO.File]::WriteAllText($scriptPath,'setInterval(()=>{},1000);')
$node=(Get-Command node.exe).Source
$child=$null
try{
    $child=Start-Process -FilePath $node -ArgumentList @(('"'+$scriptPath+'"')) -WindowStyle Hidden -PassThru
    for($i=0;$i -lt 5;$i++){
        $found=Get-ThemeHelperProcess -HostScript $scriptPath -HostPidFile $pidFile -LaunchedProcess $child
        if($found.Id -ne $child.Id){throw 'Launching handle was lost while host.pid was absent'}
    }
    $found=Get-ThemeHelperProcess -HostScript $scriptPath -HostPidFile $pidFile
    if($found.ProcessId -ne $child.Id){throw 'Restarted watcher failed to find an unregistered helper'}
    [IO.File]::WriteAllText($pidFile,[string]$PID)
    $found=Get-ThemeHelperProcess -HostScript $scriptPath -HostPidFile $pidFile
    if($found.ProcessId -ne $child.Id){throw 'Stale PID prevented exact-path recovery'}
    if(Get-ThemeHelperProcess -HostScript ($scriptPath+'-other') -HostPidFile $pidFile){throw 'Unrelated path was accepted'}
    $child.Kill();$child.WaitForExit()
    if(Get-ThemeHelperProcess -HostScript $scriptPath -HostPidFile $pidFile -LaunchedProcess $child){throw 'Exited helper was accepted'}
    Write-Output 'PASS: launch handle, watcher restart, stale PID, unrelated path, exited helper'
}finally{
    if($child){$child.Refresh();if(!$child.HasExited){$child.Kill();$child.WaitForExit()};$child.Dispose()}
    if([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($root)) -ne [IO.Path]::GetTempPath().TrimEnd('\')){throw 'Fixture cleanup escaped temp directory'}
    Remove-Item -LiteralPath $root -Recurse -Force
}
