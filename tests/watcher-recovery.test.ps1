$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\packaging\payload\New-CodexWatcherTriggers.ps1')
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$repository=Split-Path -Parent $PSScriptRoot
$reportRoot=Join-Path $repository ('experiments\watcher-recovery-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $reportRoot|Out-Null
$scriptPath=Join-Path $reportRoot 'fixture.ps1'
$runs=Join-Path $reportRoot 'runs.txt'
$body='[IO.File]::AppendAllText('''+$runs.Replace("'","''")+''',[DateTime]::UtcNow.ToString(''o'')+[Environment]::NewLine)'
[IO.File]::WriteAllText($scriptPath,$body,[Text.UTF8Encoding]::new($true))
$name='CodexGlassRecoveryTest-'+[guid]::NewGuid().ToString('N')
$shell=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$triggers=@(New-CodexWatcherTriggers -UserSid $sid)
if($triggers.Count -ne 2 -or $triggers[1].Repetition.Interval -ne 'PT1M' -or $triggers[1].Repetition.Duration){throw 'Watcher must have logon and indefinite one-minute recovery triggers'}
$action=New-ScheduledTaskAction -Execute $shell -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$scriptPath+'"')
$principal=New-ScheduledTaskPrincipal -UserId $sid -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
try{
    Register-ScheduledTask -TaskName $name -Action $action -Principal $principal -Trigger $triggers -Settings $settings|Out-Null
    Start-ScheduledTask -TaskName $name
    $deadline=[DateTime]::UtcNow.AddSeconds(95)
    do{
        $count=if(Test-Path -LiteralPath $runs){@(Get-Content -LiteralPath $runs).Count}else{0}
        if($count -ge 2){break}
        Start-Sleep -Milliseconds 500
    }while([DateTime]::UtcNow -lt $deadline)
    if($count -lt 2){throw 'Periodic trigger did not recover a successful early exit'}
    $result=[ordered]@{passed=$true;runs=$count;scope='Actual limited-user scheduled task: normal exit followed by periodic restart; no Codex callback or app process touched';reportRoot=$reportRoot}
    $result|ConvertTo-Json|Set-Content (Join-Path $reportRoot 'result.json') -Encoding UTF8
    $result|ConvertTo-Json
}finally{
    # This unique task executes only the short fixture in our verified report directory.
    Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
}
