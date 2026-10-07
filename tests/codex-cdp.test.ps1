$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\packaging\payload\theme\codex-cdp.ps1')
$script:glassListeners=@()
$script:glassTargets=@{}
$script:glassRequests=@()
function Get-NetTCPConnection { param($State,$OwningProcess) $script:glassListeners | Where-Object { $_.OwningProcess -in $OwningProcess } }
function Invoke-RestMethod { param($Uri,$TimeoutSec) $script:glassRequests+=$Uri; $script:glassTargets[[int]([Uri]$Uri).Port] }
function Assert-Equal($Actual,$Expected,$Description) {
    if($Actual -ne $Expected){throw "$Description : expected '$Expected', got '$Actual'"}
}
function Listener($Port,$Owner) { [pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=$Port;OwningProcess=$Owner} }
$process=[pscustomobject]@{ProcessId=100;CommandLine='ChatGPT.exe --remote-debugging-port=60675'}
$script:glassListeners=@((Listener 60675 100),(Listener 9222 999))
$script:glassTargets=@{60675=@([pscustomobject]@{type='page';url='app://-/index.html'});9222=@([pscustomobject]@{type='page';url='app://-/index.html'})}
Assert-Equal (Get-CodexCdpPort -Processes @($process)) 60675 'Attach to running Codex'
$process.CommandLine='ChatGPT.exe --remote-debugging-port=0'
Assert-Equal (Get-CodexCdpPort -Processes @($process)) 60675 'Discover assigned port for port 0'
$process.CommandLine='ChatGPT.exe'
Assert-Equal (Get-CodexCdpPort -Processes @($process)) 60675 'Discover app-internal CDP listener'
$script:glassListeners=@((Listener 9222 999))
$script:glassRequests=@()
Assert-Equal (Get-CodexCdpPort -Processes @($process)) $null 'Reject another app on 9222'
Assert-Equal $script:glassRequests.Count 0 'Do not query another app'
$script:glassListeners=@((Listener 60675 100))
$script:glassTargets[60675]=@([pscustomobject]@{type='page';url='app://-/index.html?initialRoute=%2Favatar-overlay'})
Assert-Equal (Get-CodexCdpPort -Processes @($process)) $null 'Require main renderer, not pet window'
Assert-Equal (Get-CodexCdpPort -Processes @()) $null 'No Codex process'

# A real temporary loopback socket proves port reservation and collision fallback.
$glassOccupied=[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,0)
$glassOccupied.Start()
$glassPreferred=([System.Net.IPEndPoint]$glassOccupied.LocalEndpoint).Port
try {
    $fallback=Select-CodexCdpPort -PreferredPort $glassPreferred
    if($fallback -eq $glassPreferred -or $fallback -le 0){throw 'Occupied port did not use a free fallback.'}
} finally { $glassOccupied.Stop() }
Assert-Equal (Select-CodexCdpPort -PreferredPort $glassPreferred) $glassPreferred 'Use preferred port when free'
Write-Output 'CDP discovery and preferred-port checks passed.'
