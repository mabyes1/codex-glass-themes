$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'codex-cdp.ps1')
$cdpPort=Get-CodexCdpPort
if($cdpPort){Write-Output $cdpPort;exit 0}
throw 'No Codex main window with CDP was found. Open Codex with remote debugging, then launch the theme switcher.'
