param([switch]$CheckOnly)
$ErrorActionPreference='Stop'

function Get-ReadyPort {
    try {
        $result=& (Join-Path $PSScriptRoot 'find-codex-cdp.ps1') 2>$null
        if($result){return [int]$result}
    } catch {}
    return $null
}

$readyPort=Get-ReadyPort
if($readyPort){
    if($CheckOnly){@{needsRestart=$false;port=$readyPort}|ConvertTo-Json -Compress}
    else{Write-Output $readyPort}
    exit 0
}

$codexProcess=Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'" |
    Where-Object { $_.CommandLine -notmatch '--type=' -and $_.ExecutablePath -match 'OpenAI\.Codex_' } |
    Sort-Object CreationDate -Descending | Select-Object -First 1

if($codexProcess -and $codexProcess.CommandLine -match '--remote-debugging-port=\d+'){
    for($attempt=0;$attempt -lt 20;$attempt++){
        Start-Sleep -Milliseconds 500
        $readyPort=Get-ReadyPort
        if($readyPort){
            if($CheckOnly){@{needsRestart=$false;port=$readyPort}|ConvertTo-Json -Compress}
            else{Write-Output $readyPort}
            exit 0
        }
    }
    throw 'Codex has a CDP flag but its main window is not ready. Please try the launcher again.'
}

if($codexProcess){
    $codexExecutable=$codexProcess.ExecutablePath
} else {
    $package=Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue | Select-Object -First 1
    if(!$package){throw 'Codex is not installed as OpenAI.Codex.'}
    $codexExecutable=Join-Path $package.InstallLocation 'app/ChatGPT.exe'
}
if(!(Test-Path -LiteralPath $codexExecutable)){throw 'Codex executable was not found.'}

if($CheckOnly){
    @{needsRestart=[bool]$codexProcess;processId=$codexProcess.ProcessId;executable=$codexExecutable}|ConvertTo-Json -Compress
    exit 0
}

$listener=[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,0)
$listener.Start()
$cdpPort=([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()

if($codexProcess){
    $oldProcess=Get-Process -Id $codexProcess.ProcessId -ErrorAction SilentlyContinue
    if($oldProcess){
        [void]$oldProcess.CloseMainWindow()
        try{Wait-Process -Id $oldProcess.Id -Timeout 12 -ErrorAction Stop}catch{}
        if(Get-Process -Id $oldProcess.Id -ErrorAction SilentlyContinue){
            Stop-Process -Id $oldProcess.Id -Force -ErrorAction Stop
            try{Wait-Process -Id $oldProcess.Id -Timeout 5 -ErrorAction Stop}catch{}
        }
    }
}

Start-Process -FilePath $codexExecutable -ArgumentList @('--remote-debugging-address=127.0.0.1',"--remote-debugging-port=$cdpPort")
for($attempt=0;$attempt -lt 60;$attempt++){
    Start-Sleep -Milliseconds 500
    $readyPort=Get-ReadyPort
    if($readyPort){Write-Output $readyPort;exit 0}
}
throw 'Codex reopened, but its CDP window did not become ready within 30 seconds.'
