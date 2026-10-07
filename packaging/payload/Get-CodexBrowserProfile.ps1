function Get-CodexBrowserProfile {
    param([Parameter(Mandatory)][int]$MainPid)
    $crashpad=Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'"|Where-Object {$_.ParentProcessId -eq $MainPid -and $_.CommandLine -match '--type=crashpad-handler'}|Select-Object -First 1
    if(!$crashpad){return $null}
    # Windows may quote the whole switch or just its value.
    $match=[regex]::Match($crashpad.CommandLine,'(?:"--user-data-dir=([^"]+)"|--user-data-dir="([^"]+)"|--user-data-dir=(\S+))')
    if(!$match.Success){return $null}
    foreach($group in $match.Groups|Select-Object -Skip 1){if($group.Success){return [IO.Path]::GetFullPath($group.Value)}}
}
