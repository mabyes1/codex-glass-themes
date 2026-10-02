param([switch]$CheckOnly,[ValidateRange(1,65535)][int]$PreferredPort=9222)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'codex-cdp.ps1')

function Get-ReadyPort {
    try {
        $result=Get-CodexCdpPort
        if($result){return [int]$result}
    } catch {}
    return $null
}

$readyPort=Get-ReadyPort
if($readyPort){
    if($CheckOnly){@{needsRestart=$false;status='ready';port=$readyPort}|ConvertTo-Json -Compress}
    else{Write-Output $readyPort}
    exit 0
}

$codexProcess=Get-CodexProcesses | Where-Object { $_.CommandLine -notmatch '--type=' } | Select-Object -First 1

if($codexProcess -and $codexProcess.CommandLine -match '--remote-debugging-port=\d+'){
    for($attempt=0;$attempt -lt 20;$attempt++){
        Start-Sleep -Milliseconds 500
        $readyPort=Get-ReadyPort
        if($readyPort){
            if($CheckOnly){@{needsRestart=$false;status='ready';port=$readyPort}|ConvertTo-Json -Compress}
            else{Write-Output $readyPort}
            exit 0
        }
    }
    if($CheckOnly){@{needsRestart=$false;status='starting';processId=$codexProcess.ProcessId}|ConvertTo-Json -Compress;exit 0}
    throw 'Codex has a CDP flag but its main window is not ready. Please try the launcher again.'
}

if($codexProcess){
    $codexExecutable=$codexProcess.ExecutablePath
} else {
    $package=Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue | Select-Object -First 1
    if(!$package){throw 'Codex is not installed as OpenAI.Codex.'}
    $codexExecutable=Join-Path $package.InstallLocation 'app/ChatGPT.exe'
    $appUserModelId=$package.PackageFamilyName+'!App'
}
if(!(Test-Path -LiteralPath $codexExecutable)){throw 'Codex executable was not found.'}

if($CheckOnly){
    $status=if($codexProcess){'running_without_cdp'}else{'closed'}
    @{needsRestart=[bool]$codexProcess;status=$status;preferredPort=$PreferredPort;processId=$codexProcess.ProcessId;executable=$codexExecutable}|ConvertTo-Json -Compress
    exit 0
}

if($codexProcess){
    Write-Output 'CODEX_CDP_REQUIRED: Codex is open without CDP. Save your work, quit Codex completely, then launch Codex Glass Themes.exe to enable CDP and apply the theme.'
    exit 20
}

$cdpPort=Select-CodexCdpPort -PreferredPort $PreferredPort

& (Join-Path $PSScriptRoot 'Start-PackagedCodex.ps1') -AppUserModelId $appUserModelId -Port $cdpPort | Out-Null
for($attempt=0;$attempt -lt 60;$attempt++){
    Start-Sleep -Milliseconds 500
    $readyPort=Get-ReadyPort
    if($readyPort){Write-Output $readyPort;exit 0}
}
throw 'Codex reopened, but its CDP window did not become ready within 30 seconds.'
