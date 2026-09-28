$ErrorActionPreference='Stop'
$codexProcesses=Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'" |
    Where-Object { $_.CommandLine -notmatch '--type=' -and $_.ExecutablePath -match 'OpenAI\.Codex_' } |
    Sort-Object CreationDate -Descending

foreach($codexProcess in $codexProcesses){
    if($codexProcess.CommandLine -notmatch '--remote-debugging-port=(\d+)'){continue}
    $cdpPort=[int]$Matches[1]
    if($cdpPort -lt 1 -or $cdpPort -gt 65535){continue}
    try {
        $targets=Invoke-RestMethod -Uri "http://127.0.0.1:$cdpPort/json/list" -TimeoutSec 2
        if($targets | Where-Object { $_.type -eq 'page' -and $_.url -eq 'app://-/index.html' }){
            Write-Output $cdpPort
            exit 0
        }
    } catch {}
}
throw 'No Codex main window with CDP was found. Open Codex with remote debugging, then launch the theme switcher.'
