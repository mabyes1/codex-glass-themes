# Shared discovery and port selection. Only attach to a listener owned by Codex.
function Get-CodexProcesses {
    @(Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'" |
        Where-Object { $_.ExecutablePath -match 'OpenAI\.Codex_' } |
        Sort-Object CreationDate -Descending)
}

function Test-CodexCdpTarget([int]$Port) {
    try {
        $targets=Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 1
        return [bool]($targets | Where-Object { $_.type -eq 'page' -and $_.url -eq 'app://-/index.html' })
    } catch { return $false }
}

function Get-CodexCdpPort {
    param([object[]]$Processes=(Get-CodexProcesses))
    if(!$Processes){return $null}
    $owners=@($Processes.ProcessId)
    $listeners=@(Get-NetTCPConnection -State Listen -OwningProcess $owners -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalAddress -in @('127.0.0.1','::1','0.0.0.0','::') })
    $ports=@()
    foreach($process in $Processes){
        if($process.CommandLine -match '--remote-debugging-port=(\d+)'){
            $port=[int]$Matches[1]
            if($port -gt 0 -and $port -le 65535 -and ($listeners | Where-Object { $_.LocalPort -eq $port })){
                $ports+=$port
            }
        }
    }
    # Also handles port 0 or an app-internal switch absent from CommandLine.
    $ports+=@($listeners.LocalPort)
    foreach($port in ($ports | Select-Object -Unique)){
        if(Test-CodexCdpTarget $port){return [int]$port}
    }
    return $null
}

function Select-CodexCdpPort {
    param([ValidateRange(1,65535)][int]$PreferredPort=9222)
    $listener=[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,$PreferredPort)
    $listener.ExclusiveAddressUse=$true
    try {
        $listener.Start()
        return $PreferredPort
    } catch [System.Net.Sockets.SocketException] {
        $listener.Stop()
        $listener=[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,0)
        $listener.Start()
        return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
    } finally { $listener.Stop() }
}
