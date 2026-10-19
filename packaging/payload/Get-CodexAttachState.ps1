function Get-CodexCdpSnapshot {
    param([Parameter(Mandatory)]$Process)
    $snapshot=[ordered]@{argumentPresent=($Process.CommandLine -match '(?i)(?:^|\s)--remote-debugging-port(?:=|\s)\d+');httpReady=$false;mainTargetPresent=$false;port=$null;error=$null}
    $listeners=@(Get-NetTCPConnection -State Listen -OwningProcess $Process.ProcessId -ErrorAction SilentlyContinue|Where-Object LocalAddress -in @('127.0.0.1','::1','0.0.0.0','::'))
    foreach($port in @($listeners.LocalPort|Select-Object -Unique)){
        try {
            $version=Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/version" -TimeoutSec 1
            if(!$version.webSocketDebuggerUrl){continue}
            $snapshot.httpReady=$true;$snapshot.port=[int]$port
            try {
                $targets=@(Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 1)
                $snapshot.mainTargetPresent=[bool]($targets|Where-Object {$_.type -eq 'page' -and $_.url -eq 'app://-/index.html'})
            }catch{$snapshot.error=$_.Exception.Message}
            if($snapshot.mainTargetPresent){break}
        }catch{$snapshot.error=$_.Exception.Message}
    }
    [pscustomobject]$snapshot
}
function Resolve-CodexAttachState {
    param([Parameter(Mandatory)]$Snapshot,[double]$AgeSeconds)
    # Absence of a page target says nothing about whether Chromium enabled CDP.
    if($Snapshot.mainTargetPresent){return 'waiting-theme'}
    if($Snapshot.httpReady){return 'waiting-main-target'}
    if($Snapshot.argumentPresent){return 'waiting-cdp'}
    if($AgeSeconds -lt 20){return 'starting'}
    return 'missing-cdp-argument'
}
