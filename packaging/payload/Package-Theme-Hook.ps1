. (Join-Path $PSScriptRoot 'New-CodexArgumentAlias.ps1')
function Disable-OwnedPackageThemeHook([string]$packageName) {
    if($packageName -notmatch '^OpenAI\.Codex_[0-9.]+_x64__2p2nqsd0c76g0$'){throw 'Unsupported package identity was preserved'}
    $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $configPath=Join-Path $PSScriptRoot ('.runtime-auto\package-hooks\'+$packageName+'.json')
    $expected='"'+(Join-Path $PSScriptRoot 'bin\PackageStartupDebugger.exe')+'" --config "'+$configPath+'"'
    $keys=@(('Registry::HKEY_USERS\'+$sid+'\Software\Classes\ActivatableClasses\Package\'+$packageName+'\DebugInformation'),('Registry::HKEY_USERS\'+$sid+'\Software\Microsoft\Windows\CurrentVersion\PackagedAppXDebug\'+$packageName))
    $owned=$false
    foreach($debugKey in $keys){
        if(Test-Path -LiteralPath $debugKey){
            if((Get-Item -LiteralPath $debugKey).GetValue('') -ne $expected){throw 'Another package debugger configuration was preserved'}
            $owned=$true
        }
    }
    if($owned){
        [PackageDebugSession]::Disable($packageName)
        foreach($debugKey in $keys){if(Test-Path -LiteralPath $debugKey){throw 'Owned package debugger cleanup did not finish'}}
    }
    $owned
}
function Initialize-PackageThemeHook {
    $script:packageSession=$null
    $script:activePackage=''
    $script:packageHookRuntime=Join-Path $PSScriptRoot '.runtime-auto'
    $script:packageHookStatus=Join-Path $script:packageHookRuntime 'package-hook-status.json'
    $script:packageHookDebugger=Join-Path $PSScriptRoot 'bin\PackageStartupDebugger.exe'
    if(!(Test-Path -LiteralPath $script:packageHookDebugger)){throw 'Package startup debugger has not been built'}
    Add-Type -Path (Join-Path $PSScriptRoot 'bin\PackageDebugSession.dll')
}
function Write-PackageThemeStatus([string]$state,[string]$message) {
    [ordered]@{state=$state;package=$script:activePackage;workerPid=$PID;message=$message;checkedAt=(Get-Date).ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath $script:packageHookStatus -Encoding UTF8
}
function Clear-PackageThemeHook {
    if($script:packageSession){
        $script:packageSession.Dispose()
        $failure=$script:packageSession.CleanupError
        $script:packageSession=$null
        if($failure){Write-PackageThemeStatus 'cleanup-error' $failure;throw $failure}
    }
    $script:activePackage=''
    Write-PackageThemeStatus 'stopped' 'Package debug session released'
}
function Sync-PackageThemeHook {
    if(!(Test-Path -LiteralPath $script:packageHookDebugger)){
        if($script:packageSession){Clear-PackageThemeHook}
        throw 'Package startup debugger is missing; package hook was cleared'
    }
    $package=Get-AppxPackage -Name OpenAI.Codex|Where-Object Status -eq 'Ok'|Sort-Object Version -Descending|Select-Object -First 1
    if(!$package){if($script:packageSession){Clear-PackageThemeHook};return}
    try{$imageArgument=New-CodexArgumentAlias -Package $package}catch{if($script:packageSession){Clear-PackageThemeHook};throw}
    if($script:activePackage -eq $package.PackageFullName -and $script:packageSession){return}
    if($script:packageSession){Clear-PackageThemeHook}
    $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    # The named watcher mutex is held here. Recover our own persisted callback
    # after an abrupt process exit or Windows shutdown, preserving other tools.
    Disable-OwnedPackageThemeHook $package.PackageFullName|Out-Null
    $image=Join-Path $package.InstallLocation 'app\ChatGPT.exe'
    if($package.PackageFullName -notmatch '^OpenAI\.Codex_[0-9.]+_x64__2p2nqsd0c76g0$' -or !(Test-Path -LiteralPath $image) -or !(Test-Path -LiteralPath (Join-Path $package.InstallLocation 'app\resources\app.asar'))){throw 'Official package layout or architecture is unsupported; native startup is preserved'}
    $directory=Join-Path $script:packageHookRuntime 'package-hooks'
    New-Item -ItemType Directory -Force -Path $directory|Out-Null
    $configPath=Join-Path $directory ($package.PackageFullName+'.json')
    $config=@{mode='user-main';package=$package.PackageFullName;sid=$sid;image=$image;imageArgument=$imageArgument;excludedPids=@();notBefore=[DateTime]::UtcNow.ToFileTimeUtc();expires=0;requiredProfile='';log=(Join-Path $script:packageHookRuntime 'package-debugger.jsonl')}
    [IO.File]::WriteAllText($configPath,($config|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
    $script:packageSession=[PackageDebugSession]::new($package.PackageFullName,('"'+$script:packageHookDebugger+'" --config "'+$configPath+'"'),[IntPtr]::Zero,0)
    $script:activePackage=$package.PackageFullName
    Write-PackageThemeStatus 'armed' 'Original packaged entry will receive loopback CDP on its next fresh activation'
}
