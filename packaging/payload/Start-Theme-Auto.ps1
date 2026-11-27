param([switch]$Stop)
$ErrorActionPreference='Stop'
$runtime=Join-Path $PSScriptRoot '.runtime-auto'
New-Item -ItemType Directory -Force -Path $runtime|Out-Null
$stopFile=Join-Path $runtime 'stop'
$pidFile=Join-Path $runtime 'watcher.pid'
if($Stop){[IO.File]::WriteAllText($stopFile,'stop');exit 0}
$mutex=[Threading.Mutex]::new($false,'Local\CodexGlassThemeAutoAttach')
try{$acquired=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$acquired=$true}
if(!$acquired){$mutex.Dispose();exit 0}
$source=Join-Path $PSScriptRoot 'theme'
$hostScript=Join-Path $source 'theme-host.mjs'
$hostPidFile=Join-Path $source '.runtime\host.pid'
$lastState=''
$lastAcceptedMain=0
$lastVerifiedAt=[DateTime]::MinValue
$lastAttachKey=''
$launchedHelper=$null
$stagingListener=$null
$launchListener=$null
$portHint=Join-Path $runtime 'cdp-target.json'
$lastTarget=''
. (Join-Path $PSScriptRoot 'Get-ThemeHelperProcess.ps1')
. (Join-Path $PSScriptRoot 'Package-Runtime.ps1')
. (Join-Path $PSScriptRoot 'Get-CodexAttachState.ps1')
Write-CodexStartupTrace 'watcher' 'start'
function Write-State([string]$value){
    if($script:lastState -eq $value){return}
    $script:lastState=$value
    $log=Join-Path $runtime 'auto.log'
    if((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 65536){[IO.File]::WriteAllText($log,'')}
    Add-Content -LiteralPath $log -Value ((Get-Date -Format s)+' '+$value) -Encoding UTF8
}
function Set-CodexTarget($Target){
    $value=if($Target){$Target|ConvertTo-Json -Compress}else{''}
    if($value -eq $script:lastTarget){return}
    if($Target){
        $temporary=$portHint+'.next'
        [IO.File]::WriteAllText($temporary,$value)
        if([IO.File]::Exists($portHint)){[IO.File]::Replace($temporary,$portHint,[NullString]::Value)}
        else{[IO.File]::Move($temporary,$portHint)}
    }else{Remove-Item -LiteralPath $portHint -ErrorAction SilentlyContinue}
    $script:lastTarget=$value
}
try{
    Remove-Item -LiteralPath $stopFile -ErrorAction SilentlyContinue
    [IO.File]::WriteAllText($pidFile,[string]$PID)
    Remove-Item -LiteralPath $portHint -ErrorAction SilentlyContinue
    $env:CODEX_THEME_CDP_HINT=$portHint
    . (Join-Path $source 'codex-cdp.ps1')
    . (Join-Path $PSScriptRoot 'Get-CodexBrowserProfile.ps1')
    . (Join-Path $PSScriptRoot 'Package-Theme-Hook.ps1')
    Invoke-CodexStartupPhase 'initialize-hook' {Initialize-PackageThemeHook}
    try{$stagingListener=Start-CodexStagingListener}catch{Write-CodexStartupTrace 'package-staging' 'unavailable' 0 $_.Exception.Message}
    try{
        $launchListener=[IO.FileSystemWatcher]::new($runtime,'package-debugger.jsonl')
        $launchListener.NotifyFilter=[IO.NotifyFilters]'LastWrite, FileName'
        Register-ObjectEvent -InputObject $launchListener -EventName Changed -SourceIdentifier CodexThemeEntryStarted
        Register-ObjectEvent -InputObject $launchListener -EventName Created -SourceIdentifier CodexThemeEntryCreated
        $launchListener.EnableRaisingEvents=$true
    }catch{Write-CodexStartupTrace 'launch-notification' 'unavailable' 0 $_.Exception.Message}
    $node=Join-Path $PSScriptRoot 'runtime\node.exe'
    if(!(Test-Path -LiteralPath $node)){throw 'Bundled Node runtime is missing'}
    while(!(Test-Path -LiteralPath $stopFile)){
        foreach($eventName in 'CodexThemeEntryStarted','CodexThemeEntryCreated'){
            Get-Event -SourceIdentifier $eventName -ErrorAction SilentlyContinue|Remove-Event
        }
        $fastAttach=$false
        try{
            try{
                Sync-StagedThemeHook
                Sync-PackageThemeHook
                while($script:stagedThemeHook -and !$script:stagedThemeHook.session -and
                      $script:activePackage -ne $script:stagedThemeHook.package.PackageFullName -and
                      [DateTime]::UtcNow -lt $script:stagedThemeHook.retryUntil -and !(Test-Path -LiteralPath $stopFile)){
                    Start-Sleep -Milliseconds 100
                    Sync-PackageThemeHook
                }
            }catch{Write-State ('Package hook: '+$_.Exception.Message)}
            $codex=@(Get-CodexProcesses)
            $browserPath=Join-Path $env:APPDATA 'Codex\web\Codex'
            $candidate=$codex|Where-Object {
                $_.CommandLine -notmatch '--type=' -and (Get-CodexBrowserProfile -MainPid $_.ProcessId -Processes $codex) -eq $browserPath
            }|Select-Object -First 1
            $fastAttach=[bool]($codex.Count -and (!$candidate -or (!$lastTarget -and $candidate.CommandLine -match '--remote-debugging-port')))
            if(!$candidate -or ($lastTarget -and ($lastTarget|ConvertFrom-Json).mainPid -ne $candidate.ProcessId)){Set-CodexTarget $null}
            $hostProcess=Get-ThemeHelperProcess -HostScript $hostScript -HostPidFile $hostPidFile -LaunchedProcess $launchedHelper
            if($candidate -and (!$lastTarget -or !$hostProcess -or $candidate.ProcessId -ne $lastAcceptedMain -or ([DateTime]::UtcNow-$lastVerifiedAt).TotalSeconds -ge 30)){
                $browserProfile=$browserPath
                $snapshot=Get-CodexCdpSnapshot -Process $candidate
                $age=([DateTime]::UtcNow-$candidate.CreationDate.ToUniversalTime()).TotalSeconds
                $state=Resolve-CodexAttachState -Snapshot $snapshot -AgeSeconds $age
                $attachKey=$candidate.ProcessId.ToString()+'|'+$candidate.CreationDate.ToString('o')+'|'+$state
                if($lastAttachKey -ne $attachKey){
                    [ordered]@{state=$state;mainPid=$candidate.ProcessId;mainCreated=$candidate.CreationDate.ToString('o');package=$script:activePackage;argumentPresent=$snapshot.argumentPresent;httpReady=$snapshot.httpReady;mainTargetPresent=$snapshot.mainTargetPresent;port=$snapshot.port;checkedAt=(Get-Date).ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $runtime 'attach-status.json') -Encoding UTF8
                    Write-CodexStartupTrace 'attach' $state 0 ('mainPid='+$candidate.ProcessId+';argument='+$snapshot.argumentPresent+';http='+$snapshot.httpReady)
                    $lastAttachKey=$attachKey
                }
                if(!$snapshot.mainTargetPresent){
                    Set-CodexTarget $null
                    Write-State 'Codex is open; waiting for usable CDP'
                }else{
                    $livePort=$snapshot.port
                    Set-CodexTarget ([ordered]@{port=$livePort;mainPid=$candidate.ProcessId})
                    $fastAttach=$false
                    if(!$hostProcess){
                        $launchedHelper=Start-Process -FilePath $node -ArgumentList @('"'+$hostScript+'"') -NoNewWindow -WorkingDirectory $source -RedirectStandardOutput (Join-Path $runtime 'host.log') -RedirectStandardError (Join-Path $runtime 'host-error.log') -PassThru
                        $hostProcess=$launchedHelper
                        Write-State ('Started theme helper: PID '+$launchedHelper.Id+', CDP '+$livePort)
                    }
                    $probeInfo=[Diagnostics.ProcessStartInfo]::new($node,('"'+(Join-Path $PSScriptRoot 'Probe-CdpSocket.mjs')+'" port:'+$livePort+' --inspect-theme'))
                    $probeInfo.UseShellExecute=$false
                    $probeInfo.CreateNoWindow=$true
                    $probeInfo.RedirectStandardOutput=$true
                    $probeInfo.RedirectStandardError=$true
                    $probe=[Diagnostics.Process]::Start($probeInfo)
                    try{
                        $probeError=$probe.StandardError.ReadToEndAsync()
                        $probeJson=$probe.StandardOutput.ReadToEnd()
                        $probe.WaitForExit()
                        if($probe.ExitCode -ne 0){throw ('Theme probe failed: '+$probeError.GetAwaiter().GetResult())}
                        $acceptance=$probeJson|ConvertFrom-Json
                    }finally{$probe.Dispose()}
                    $lastVerifiedAt=[DateTime]::UtcNow
                    if($acceptance.rendererReady -and $acceptance.theme.mounted -and $acceptance.theme.nativeReady -and !$acceptance.error){
                        [ordered]@{mainPid=$candidate.ProcessId;image=$candidate.ExecutablePath;mainCreated=$candidate.CreationDate.ToString('o');browserProfile=$browserProfile;port=$livePort;renderer=$acceptance.renderer;theme=$acceptance.theme;checkedAt=(Get-Date).ToString('o')}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $runtime 'live-acceptance.json') -Encoding UTF8
                        [ordered]@{state='connected';mainPid=$candidate.ProcessId;port=$livePort;checkedAt=(Get-Date).ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $runtime 'attach-status.json') -Encoding UTF8
                        $lastAcceptedMain=$candidate.ProcessId
                        Write-State ('Live user theme verified: PID '+$candidate.ProcessId+', CDP '+$livePort)
                        Write-CodexStartupTrace 'attach' 'connected' 0 ('mainPid='+$candidate.ProcessId+';port='+$livePort)
                    }else{
                        $lastAcceptedMain=0
                        $nativeState=if($acceptance.theme.nativeFailed){'native-background-error'}elseif($acceptance.theme.nativePending){'waiting-native-window'}else{'waiting-theme'}
                        [ordered]@{state=$nativeState;mainPid=$candidate.ProcessId;port=$livePort;nativeFailed=$acceptance.theme.nativeFailed;nativePending=$acceptance.theme.nativePending;error=$acceptance.error;checkedAt=(Get-Date).ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $runtime 'attach-status.json') -Encoding UTF8
                    }
                }
            }elseif(!$candidate){Write-State 'Waiting for Codex'}
        }catch{Write-State ('Error: '+$_.Exception.Message)}
        [ordered]@{workerPid=$PID;state=$lastState;checkedAt=(Get-Date).ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $runtime 'watcher-health.json') -Encoding UTF8
        $delay=if($fastAttach){1}else{5}
        Wait-Event -Timeout $delay|Out-Null
    }
}catch{
    Write-State ('Startup error: '+$_.Exception.Message)
    throw
}finally{
    if($launchListener){
        foreach($eventName in 'CodexThemeEntryStarted','CodexThemeEntryCreated'){
            Unregister-Event -SourceIdentifier $eventName -ErrorAction SilentlyContinue
            Get-Event -SourceIdentifier $eventName -ErrorAction SilentlyContinue|Remove-Event
        }
        $launchListener.Dispose()
    }
    Set-CodexTarget $null
    try{[ordered]@{workerPid=$PID;state='stopped';checkedAt=(Get-Date).ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $runtime 'watcher-health.json') -Encoding UTF8}catch{}
    try{if($stagingListener){Stop-CodexStagingListener $stagingListener};Clear-StagedThemeHook}catch{Write-State ('Package staging cleanup error: '+$_.Exception.Message)}
    try{Clear-PackageThemeHook}catch{Write-State ('Package hook cleanup error: '+$_.Exception.Message)}
    Remove-Item -LiteralPath $pidFile -ErrorAction SilentlyContinue
    Write-State 'Auto attach stopped'
    $mutex.ReleaseMutex();$mutex.Dispose()
}
