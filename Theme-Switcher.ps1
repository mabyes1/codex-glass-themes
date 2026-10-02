param([switch]$Stop)
$ErrorActionPreference='Stop'
$runtime=Join-Path $PSScriptRoot '.runtime'
New-Item -ItemType Directory -Force $runtime | Out-Null
if($Stop){New-Item -ItemType File -Force (Join-Path $runtime 'stop')|Out-Null;Write-Host 'Restoring original appearance...';exit}
$cdpPort=& (Join-Path $PSScriptRoot 'Ensure-CodexCdp.ps1')
if($LASTEXITCODE -eq 20){Write-Output $cdpPort;exit 20}
if(!$cdpPort){throw 'Codex CDP is not ready.'}
$pidFile=Join-Path $runtime 'host.pid'
if(Test-Path $pidFile){$themePid=Get-Content $pidFile; $running=Get-CimInstance Win32_Process -Filter "ProcessId=$themePid" -ErrorAction SilentlyContinue;if($running.CommandLine -like '*theme-host.mjs*'){Write-Host "Theme switcher is already running on Codex CDP port $cdpPort.";exit}}
$node=(Get-Command node.exe -ErrorAction Stop).Source
$hostScript=Join-Path $PSScriptRoot 'theme-host.mjs'
$hostLog=Join-Path $runtime 'host.log'
$hostError=Join-Path $runtime 'host-error.log'
Remove-Item -LiteralPath $hostLog,$hostError -ErrorAction SilentlyContinue
$hostProcess=Start-Process -FilePath $node -ArgumentList @('"'+$hostScript+'"') -WindowStyle Hidden -WorkingDirectory $PSScriptRoot -RedirectStandardOutput $hostLog -RedirectStandardError $hostError -PassThru
for($attempt=0;$attempt -lt 20;$attempt++){
    Start-Sleep -Milliseconds 500
    if((Test-Path $hostLog) -and (Get-Content -LiteralPath $hostLog -Raw) -match 'Theme switcher connected'){
        Write-Host "Theme switcher connected to Codex CDP port $cdpPort."
        exit 0
    }
    if($hostProcess.HasExited){break}
}
$details=if(Test-Path $hostError){Get-Content -LiteralPath $hostError -Raw}else{'No error log.'}
throw "Theme switcher did not connect. $details"
