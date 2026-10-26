param([string]$InstallRoot=(Join-Path $env:USERPROFILE 'CodexGlass'),[switch]$CheckOnly,[switch]$NoRestart)
$ErrorActionPreference='Stop'
$InstallRoot=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$markerPath=Join-Path $InstallRoot 'installation.json'
$owner=Get-Content -LiteralPath $markerPath -Raw -Encoding UTF8|ConvertFrom-Json
if($owner.product -ne 'CodexGlassThemes' -or $owner.sid -ne $sid -or $owner.root -ne $InstallRoot -or $owner.mode -ne 'Install'){throw 'Installation identity does not match this account and directory.'}
function Assert-Ordinary([string]$path){
    $current=[IO.Path]::GetFullPath($path)
    while($current){
        if((Test-Path -LiteralPath $current) -and ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw ('Redirected path was preserved: '+$current)}
        $current=[IO.Path]::GetDirectoryName($current)
    }
}
Assert-Ordinary $InstallRoot
$source=Join-Path $PSScriptRoot 'payload'
if(!(Test-Path -LiteralPath $source)){$source=Join-Path $PSScriptRoot '..\packaging\payload'}
$files=@('Start-Theme-Auto.ps1','Get-ThemeHelperProcess.ps1','Setup-Theme.ps1','theme\theme-host.mjs','theme\host-lease.mjs','theme\token-feed.mjs')
foreach($relative in $files){
    if(!(Test-Path -LiteralPath (Join-Path $source $relative) -PathType Leaf)){throw ('Repair file missing: '+$relative)}
    Assert-Ordinary (Join-Path $InstallRoot $relative)
}
$startScript=Join-Path $InstallRoot 'Start-Theme-Auto.ps1'
$hostScript=Join-Path $InstallRoot 'theme\theme-host.mjs'
$nativeExe=Join-Path $InstallRoot 'theme\NativeBackdropWatch.exe'
$taskName='CodexGlassThemeAutoAttach-'+$sid
$task=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if($task -and (@($task.Actions).Count -ne 1 -or $task.Actions[0].Arguments.IndexOf(('"'+$startScript+'"'),[StringComparison]::OrdinalIgnoreCase) -lt 0)){throw 'Scheduled task belongs to another directory.'}
function Get-OwnedHelpers {
    foreach($candidate in @(Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='powershell.exe' OR Name='pwsh.exe' OR Name='NativeBackdropWatch.exe'")){
        $matchesPath=($candidate.Name -eq 'NativeBackdropWatch.exe' -and $candidate.ExecutablePath -eq $nativeExe) -or
            ($candidate.Name -eq 'node.exe' -and $candidate.CommandLine -and $candidate.CommandLine.IndexOf(('"'+$hostScript+'"'),[StringComparison]::OrdinalIgnoreCase) -ge 0) -or
            ($candidate.Name -in @('powershell.exe','pwsh.exe') -and $candidate.CommandLine -and $candidate.CommandLine.IndexOf(('"'+$startScript+'"'),[StringComparison]::OrdinalIgnoreCase) -ge 0)
        if($matchesPath){
            if((Invoke-CimMethod -InputObject $candidate -MethodName GetOwnerSid).Sid -ne $sid){throw ('Process belongs to another account: '+$candidate.ProcessId)}
            $candidate
        }
    }
}
$before=@(Get-OwnedHelpers)
if($CheckOnly){[ordered]@{root=$InstallRoot;processes=@($before|Select-Object ProcessId,Name);files=$files;action='check-only'}|ConvertTo-Json -Depth 4;return}
$guard=[Threading.Mutex]::new($false,'Local\CodexGlassSetup-'+$sid)
$held=$false
try{try{$held=$guard.WaitOne(0)}catch [Threading.AbandonedMutexException]{$held=$true};if(!$held){throw 'Another install or repair is running.'}
    $backup=Join-Path $InstallRoot ('repair-backup-'+(Get-Date -Format yyyyMMdd-HHmmss)+'-'+[guid]::NewGuid().ToString('N').Substring(0,6))
    New-Item -ItemType Directory -Path $backup|Out-Null
    foreach($relative in ($files+@('installation.json','payload.json'))){
        $existing=Join-Path $InstallRoot $relative
        if(Test-Path -LiteralPath $existing){$target=Join-Path $backup $relative;New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target)|Out-Null;Copy-Item -LiteralPath $existing -Destination $target}
    }
    $enabled=$task -and $task.State -ne 'Disabled'
    try{
        if($enabled){Disable-ScheduledTask -TaskName $taskName|Out-Null}
        foreach($relative in @('.runtime-auto\stop','theme\.runtime\stop')){$target=Join-Path $InstallRoot $relative;Assert-Ordinary $target;New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target)|Out-Null;[IO.File]::WriteAllText($target,'stop')}
        Start-Sleep -Seconds 3
        foreach($candidate in @(Get-OwnedHelpers)){
            $current=Get-CimInstance Win32_Process -Filter ('ProcessId='+$candidate.ProcessId) -ErrorAction SilentlyContinue
            if($current -and $current.CreationDate -eq $candidate.CreationDate){Stop-Process -Id $candidate.ProcessId -Force -ErrorAction Stop}
        }
        if(@(Get-OwnedHelpers).Count){throw 'Helpers are still exiting. Backup was retained; run repair again.'}
        foreach($relative in $files){Copy-Item -LiteralPath (Join-Path $source $relative) -Destination (Join-Path $InstallRoot $relative) -Force}
        # Refresh the installed file list using file presence and size only.
        $manifestPath=Join-Path $InstallRoot 'payload.json'
        if(Test-Path -LiteralPath $manifestPath){
            $manifest=Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8|ConvertFrom-Json
            foreach($relative in $files){$portable=$relative.Replace('\','/');$manifest.files=@($manifest.files|Where-Object path -ne $portable)+@([pscustomobject]@{path=$portable;bytes=(Get-Item -LiteralPath (Join-Path $InstallRoot $relative)).Length})}
            $manifest.files=@($manifest.files|ForEach-Object {[ordered]@{path=$_.path;bytes=$_.bytes}})
            $manifest.version='2.0.1';[IO.File]::WriteAllText($manifestPath,($manifest|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
        }
        $owner|Add-Member -NotePropertyName helperRepairVersion -NotePropertyValue '2.0.1' -Force
        [IO.File]::WriteAllText($markerPath,($owner|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
    }catch{
        # Restore code before restoring automatic startup after a failed copy.
        foreach($relative in ($files+@('installation.json','payload.json'))){$saved=Join-Path $backup $relative;if(Test-Path -LiteralPath $saved){Copy-Item -LiteralPath $saved -Destination (Join-Path $InstallRoot $relative) -Force}}
        throw
    }finally{if($enabled){Enable-ScheduledTask -TaskName $taskName|Out-Null}}
    if(!$NoRestart -and $enabled){Start-ScheduledTask -TaskName $taskName}
    elseif(!$NoRestart -and !$task){Start-Process -FilePath (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe') -ArgumentList @('-NoProfile','-NonInteractive','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',('"'+$startScript+'"')) -WindowStyle Hidden|Out-Null}
    [ordered]@{ok=$true;root=$InstallRoot;helpersBefore=$before.Count;backup=$backup;repairVersion='2.0.1';restartRequested=(!$NoRestart -and (!$task -or $enabled))}|ConvertTo-Json
}finally{if($held){$guard.ReleaseMutex()};$guard.Dispose()}
