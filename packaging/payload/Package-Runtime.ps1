function Write-CodexStartupTrace {
    param([string]$Phase,[string]$Event,[double]$ElapsedMs=0,[string]$Detail='')
    if(!$script:codexStartupClock){$script:codexStartupClock=[Diagnostics.Stopwatch]::StartNew()}
    $trace=Join-Path $PSScriptRoot '.runtime-auto\startup-trace.jsonl'
    try {
        $directory=Split-Path -Parent $trace
        if(!(Test-Path -LiteralPath $directory)){New-Item -ItemType Directory -Path $directory -Force|Out-Null}
        if((Test-Path -LiteralPath $trace) -and (Get-Item -LiteralPath $trace).Length -gt 1048576){Move-Item -LiteralPath $trace -Destination ($trace+'.previous') -Force}
        $line=[ordered]@{at=[DateTimeOffset]::Now.ToString('o');workerPid=$PID;phase=$Phase;event=$Event;elapsedMs=[Math]::Round($ElapsedMs,2);sinceStartMs=[Math]::Round($script:codexStartupClock.Elapsed.TotalMilliseconds,2);detail=$Detail}|ConvertTo-Json -Compress
        [IO.File]::AppendAllText($trace,$line+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
    } catch { Write-Warning ('Startup trace: '+$_.Exception.Message) }
}
function Invoke-CodexStartupPhase {
    param([string]$Phase,[scriptblock]$Action)
    $clock=[Diagnostics.Stopwatch]::StartNew()
    Write-CodexStartupTrace $Phase 'begin'
    try { & $Action; Write-CodexStartupTrace $Phase 'complete' $clock.Elapsed.TotalMilliseconds }
    catch {Write-CodexStartupTrace $Phase 'error' $clock.Elapsed.TotalMilliseconds $_.Exception.Message;throw}
}
function Initialize-CodexPackageRuntime {
    if('CodexPackageCatalog' -as [type]){return}
    $library=Join-Path $PSScriptRoot '.runtime-ifeo\PackageDebugSession.dll'
    if(!(Test-Path -LiteralPath $library)){$library=Join-Path $PSScriptRoot 'bin\PackageDebugSession.dll'}
    if(!(Test-Path -LiteralPath $library)){throw 'Precompiled package runtime is missing; run the installer to build it before login'}
    Invoke-CodexStartupPhase 'load-package-runtime' { [Reflection.Assembly]::Load([IO.File]::ReadAllBytes($library))|Out-Null }
}
function Get-CodexRegisteredPackages {
    Initialize-CodexPackageRuntime
    [CodexPackageCatalog]::Find()
}
function Get-CodexInstalledPackage {
    $clock=[Diagnostics.Stopwatch]::StartNew()
    $packages=@(Get-CodexRegisteredPackages|Where-Object { $_.PackageFullName -match '^OpenAI\.Codex_[0-9.]+_x64__2p2nqsd0c76g0$' })
    $valid=@(foreach($package in $packages){
        $expected=Join-Path (Join-Path $env:ProgramFiles 'WindowsApps') $package.PackageFullName
        if([IO.Path]::GetFullPath($package.InstallLocation).TrimEnd('\') -ne $expected){continue}
        if(!(Test-Path -LiteralPath (Join-Path $expected 'app\ChatGPT.exe')) -or !(Test-Path -LiteralPath (Join-Path $expected 'app\resources\app.asar'))){continue}
        # The API enumerates packages registered to this user, not staged directories.
        [pscustomobject]@{PackageFullName=$package.PackageFullName;InstallLocation=$expected;Version=[version]($package.PackageFullName.Split('_')[1]);PackageFamilyName='OpenAI.Codex_2p2nqsd0c76g0'}
    })
    if(!$script:codexCatalogTraced -or $clock.Elapsed.TotalMilliseconds -gt 100){Write-CodexStartupTrace 'package-catalog' 'complete' $clock.Elapsed.TotalMilliseconds ('registered='+$packages.Count+';valid='+$valid.Count);$script:codexCatalogTraced=$true}
    $valid|Sort-Object Version -Descending|Select-Object -First 1
}
