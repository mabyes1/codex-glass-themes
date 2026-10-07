param([switch]$Stop)
$ErrorActionPreference='Stop'
$runtime=Join-Path $PSScriptRoot '.runtime-auto'
New-Item -ItemType Directory -Force -Path $runtime|Out-Null
$stopFile=Join-Path $runtime 'stop'
$pidFile=Join-Path $runtime 'watcher.pid'
if($Stop){[IO.File]::WriteAllText($stopFile,'stop');exit 0}
$mutex=[Threading.Mutex]::new($false,'Local\CodexGlassThemeAutoAttach')
if(!$mutex.WaitOne(0)){$mutex.Dispose();exit 0}
$source=Join-Path $PSScriptRoot 'theme'
$hostScript=Join-Path $source 'theme-host.mjs'
$hostPidFile=Join-Path $source '.runtime\host.pid'
$lastState=''
$lastAcceptedMain=0
$lastRestartRequiredMain=0
function Write-State([string]$value){
    if($script:lastState -eq $value){return}
    $script:lastState=$value
    $log=Join-Path $runtime 'auto.log'
    if((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 65536){[IO.File]::WriteAllText($log,'')}
    Add-Content -LiteralPath $log -Value ((Get-Date -Format s)+' '+$value) -Encoding UTF8
}
try{
    Remove-Item -LiteralPath $stopFile -ErrorAction SilentlyContinue
    [IO.File]::WriteAllText($pidFile,[string]$PID)
    . (Join-Path $source 'codex-cdp.ps1')
    . (Join-Path $PSScriptRoot 'Get-CodexBrowserProfile.ps1')
    . (Join-Path $PSScriptRoot 'Package-Theme-Hook.ps1')
    Initialize-PackageThemeHook
    $node=Join-Path $PSScriptRoot 'runtime\node.exe'
    if(!(Test-Path -LiteralPath $node)){throw 'Bundled Node runtime is missing'}
    while(!(Test-Path -LiteralPath $stopFile)){
        try{
            try{Sync-PackageThemeHook}catch{Write-State ('Package hook: '+$_.Exception.Message)}
            $hostProcess=$null
            if(Test-Path -LiteralPath $hostPidFile){
                $hostId=0
                if([int]::TryParse((Get-Content -LiteralPath $hostPidFile -Raw).Trim(),[ref]$hostId)){
                    $candidate=Get-CimInstance Win32_Process -Filter "ProcessId=$hostId" -ErrorAction SilentlyContinue
                    if($candidate.Name -eq 'node.exe' -and $candidate.CommandLine.IndexOf($hostScript,[StringComparison]::OrdinalIgnoreCase) -ge 0){$hostProcess=$candidate}
                }
            }
            if($hostProcess){if(!$lastRestartRequiredMain){Write-State ('Theme helper running: PID '+$hostProcess.ProcessId)}}
            else{
                $codex=@(Get-CodexProcesses)
                if(!$codex.Count){Write-State 'Waiting for ChatGPT'}
                else{
                    $port=Get-CodexCdpPort -Processes $codex
                    if(!$port){Write-State 'ChatGPT is open; waiting for usable CDP'}
                    else{
                        $helper=Start-Process -FilePath $node -ArgumentList @('"'+$hostScript+'"') -WindowStyle Hidden -WorkingDirectory $source -RedirectStandardOutput (Join-Path $runtime 'host.log') -RedirectStandardError (Join-Path $runtime 'host-error.log') -PassThru
                        Write-State ('Started theme helper: PID '+$helper.Id+', CDP '+$port)
                    }
                }
            }
            $liveMain=@(Get-CodexProcesses|Where-Object {$_.CommandLine -notmatch '--type=' -and $_.CommandLine -notlike ('*'+(Join-Path $PSScriptRoot 'experiments')+'*') -and $_.ProcessId -ne $lastAcceptedMain})
            foreach($candidate in $liveMain){
                $browserProfile=Get-CodexBrowserProfile -MainPid $candidate.ProcessId
                if($browserProfile -ne (Join-Path $env:APPDATA 'Codex\web\Codex')){continue}
                $livePort=Get-CodexCdpPort -Processes @($candidate)
                if(!$livePort){
                    if($lastRestartRequiredMain -ne $candidate.ProcessId -and ([DateTime]::UtcNow-$candidate.CreationDate.ToUniversalTime()).TotalSeconds -ge 20){
                        [ordered]@{state='restart-required';mainPid=$candidate.ProcessId;package=$script:activePackage;reason='The current app started without CDP. Fully quit and reopen after the package hook is armed.';checkedAt=(Get-Date).ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $runtime 'attach-status.json') -Encoding UTF8
                        $lastRestartRequiredMain=$candidate.ProcessId
                        Write-State ('Restart required: ChatGPT PID '+$candidate.ProcessId+' started without CDP; the next packaged activation can receive the theme')
                    }
                    continue
                }
                $acceptance=(& $node (Join-Path $PSScriptRoot 'Probe-CdpSocket.mjs') ('port:'+$livePort) --inspect-theme|ConvertFrom-Json)
                if($acceptance.rendererReady -and $acceptance.theme.mounted -and !$acceptance.error){
                    [ordered]@{mainPid=$candidate.ProcessId;image=$candidate.ExecutablePath;mainCreated=$candidate.CreationDate.ToString('o');browserProfile=$browserProfile;port=$livePort;renderer=$acceptance.renderer;theme=$acceptance.theme;checkedAt=(Get-Date).ToString('o')}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $runtime 'live-acceptance.json') -Encoding UTF8
                    $lastRestartRequiredMain=0
                    [ordered]@{state='connected';mainPid=$candidate.ProcessId;port=$livePort;checkedAt=(Get-Date).ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $runtime 'attach-status.json') -Encoding UTF8
                    $lastAcceptedMain=$candidate.ProcessId
                    Write-State ('Live user theme verified: PID '+$candidate.ProcessId+', CDP '+$livePort)
                }
            }
        }catch{Write-State ('Error: '+$_.Exception.Message)}
        Start-Sleep -Seconds 5
    }
}finally{
    try{Clear-PackageThemeHook}catch{Write-State ('Package hook cleanup error: '+$_.Exception.Message)}
    Remove-Item -LiteralPath $pidFile -ErrorAction SilentlyContinue
    Write-State 'Auto attach stopped'
    $mutex.ReleaseMutex();$mutex.Dispose()
}
