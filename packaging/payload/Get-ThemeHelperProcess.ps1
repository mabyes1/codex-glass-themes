function Get-ThemeHelperProcess {
    param([string]$HostScript,[string]$HostPidFile,$LaunchedProcess)
    # Keep the actual Start-Process handle while the helper initializes.
    if($LaunchedProcess){
        $LaunchedProcess.Refresh()
        if(!$LaunchedProcess.HasExited){return $LaunchedProcess}
    }
    $hostId=0
    if(Test-Path -LiteralPath $HostPidFile){
        [void][int]::TryParse(([IO.File]::ReadAllText($HostPidFile)).Trim(),[ref]$hostId)
    }
    # A restarted watcher must also find helpers launched before host.pid exists.
    # Match the full quoted script argument, not a wildcard or a similar path.
    $argument='"'+$HostScript+'"'
    $candidates=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue)
    $matching=@($candidates|Where-Object {
        $_.CommandLine -and $_.CommandLine.IndexOf($argument,[StringComparison]::OrdinalIgnoreCase) -ge 0
    })
    $owner=$matching|Where-Object ProcessId -eq $hostId|Select-Object -First 1
    if($owner){return $owner}
    $matching|Sort-Object CreationDate|Select-Object -First 1
}
