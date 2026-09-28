param([switch]$Stop)
$ErrorActionPreference='Stop'
$runtime=Join-Path $PSScriptRoot '.runtime'
New-Item -ItemType Directory -Force $runtime | Out-Null
if($Stop){New-Item -ItemType File -Force (Join-Path $runtime 'stop')|Out-Null;Write-Host 'Restoring original appearance...';exit}
$pidFile=Join-Path $runtime 'host.pid'
if(Test-Path $pidFile){$themePid=Get-Content $pidFile; $running=Get-CimInstance Win32_Process -Filter "ProcessId=$themePid" -ErrorAction SilentlyContinue;if($running.CommandLine -like '*theme-host.mjs*'){Write-Host 'Theme switcher is already running.';exit}}
$node=(Get-Command node.exe -ErrorAction Stop).Source
$hostScript=Join-Path $PSScriptRoot 'theme-host.mjs'
Start-Process -FilePath $node -ArgumentList @('"'+$hostScript+'"') -WindowStyle Hidden -WorkingDirectory $PSScriptRoot -RedirectStandardOutput (Join-Path $runtime 'host.log') -RedirectStandardError (Join-Path $runtime 'host-error.log')
Write-Host 'Theme switcher started. Look for the Theme button at the top of Codex.'
