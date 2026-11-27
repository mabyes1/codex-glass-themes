. (Join-Path $PSScriptRoot 'New-CodexArgumentAlias.ps1')
. (Join-Path $PSScriptRoot 'Package-Runtime.ps1')
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
    $script:stagedThemeHook=$null
    $script:activePackage=''
    $script:packageHookRuntime=Join-Path $PSScriptRoot '.runtime-auto'
    $script:packageHookStatus=Join-Path $script:packageHookRuntime 'package-hook-status.json'
    $script:packageHookDebugger=Join-Path $PSScriptRoot 'bin\PackageStartupDebugger.exe'
    if(!(Test-Path -LiteralPath $script:packageHookDebugger)){throw 'Package startup debugger has not been built'}
    Initialize-CodexPackageRuntime
}
function Write-PackageThemeStatus([string]$state,[string]$message) {
    [ordered]@{state=$state;package=$script:activePackage;workerPid=$PID;message=$message;checkedAt=(Get-Date).ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath $script:packageHookStatus -Encoding UTF8
}
function Start-CodexStagingListener {
    $log='Microsoft-Windows-AppXDeploymentServer/Operational'
    $filter="*[System[EventID=400 and Version=0] and EventData[Data[@Name='DeploymentOperation']='4']]"
    $query=[Diagnostics.Eventing.Reader.EventLogQuery]::new($log,[Diagnostics.Eventing.Reader.PathType]::LogName,$filter)
    $listener=[Diagnostics.Eventing.Reader.EventLogWatcher]::new($query)
    try{
        Register-ObjectEvent -InputObject $listener -EventName EventRecordWritten -SourceIdentifier CodexThemePackageStaged
        $listener.Enabled=$true
        Write-CodexStartupTrace 'package-staging' 'listening'
    }catch{
        Stop-CodexStagingListener $listener
        throw
    }
    $listener
}
function Stop-CodexStagingListener($Listener) {
    Unregister-Event -SourceIdentifier CodexThemePackageStaged -ErrorAction SilentlyContinue
    $Listener.Dispose()
    foreach($event in @(Get-Event -SourceIdentifier CodexThemePackageStaged -ErrorAction SilentlyContinue)){
        if($event.SourceEventArgs.EventRecord){$event.SourceEventArgs.EventRecord.Dispose()}
        Remove-Event -EventIdentifier $event.EventIdentifier
    }
}
function Clear-StagedThemeHook {
    $staged=$script:stagedThemeHook
    $script:stagedThemeHook=$null
    if($staged -and $staged.session){
        $staged.session.Dispose()
        if($staged.session.CleanupError){Write-CodexStartupTrace 'package-staging' 'cleanup-error' 0 $staged.session.CleanupError}
    }
}
function Sync-StagedThemeHook {
    if($script:stagedThemeHook -and [DateTime]::UtcNow -ge $script:stagedThemeHook.expires){Clear-StagedThemeHook}
    foreach($notification in @(Get-Event -SourceIdentifier CodexThemePackageStaged -ErrorAction SilentlyContinue)){
        $record=$notification.SourceEventArgs.EventRecord
        try{
            if(!$record){
                Write-CodexStartupTrace 'package-staging' 'listener-error' 0 $notification.SourceEventArgs.EventException.Message
                continue
            }
            $name=[string]$record.Properties[1].Value
            if($name -notmatch '^OpenAI\.Codex_(\d+\.\d+\.\d+\.\d+)_x64__2p2nqsd0c76g0$'){continue}
            $version=[version]$Matches[1]
            if(!$script:packageSession -or !$script:activePackage -or $version -le [version]($script:activePackage.Split('_')[1])){continue}
            if($script:stagedThemeHook -and $version -le $script:stagedThemeHook.package.Version){continue}
            if(([DateTime]::UtcNow-$record.TimeCreated.ToUniversalTime()).TotalSeconds -gt 10){continue}
            $package=[pscustomobject]@{PackageFullName=$name;Version=$version;InstallLocation=(Join-Path $env:ProgramFiles ('WindowsApps\'+$name))}
            $alias=New-CodexArgumentAlias -Package $package
            Clear-StagedThemeHook
            $now=[DateTime]::UtcNow
            $script:stagedThemeHook=@{package=$package;alias=$alias;retryUntil=$now.AddSeconds(4);expires=$now.AddSeconds(20);session=$null}
            Write-CodexStartupTrace 'package-staging' 'prepared' 0 $name
            try{
                $script:stagedThemeHook.session=New-PackageThemeSession $package $alias
                Write-CodexStartupTrace 'package-staging' 'armed-before-registration' 0 $name
            }catch{
                # Some Windows versions only accept an already registered package.
                Write-CodexStartupTrace 'package-staging' 'waiting-for-registration' 0 $_.Exception.Message
            }
        }catch{Write-CodexStartupTrace 'package-staging' 'error' 0 $_.Exception.Message}
        finally{
            if($record){$record.Dispose()}
            Remove-Event -EventIdentifier $notification.EventIdentifier
        }
    }
}
function Clear-PackageThemeHook([switch]$AllowRemovedPackage) {
    if($script:packageSession){
        $script:packageSession.Dispose()
        $failure=$script:packageSession.CleanupError
        $script:packageSession=$null
        if($failure){
            $removed=$AllowRemovedPackage -and $failure -eq 'DisableDebugging HRESULT -2147023728' -and !(Get-CodexRegisteredPackages|Where-Object PackageFullName -eq $script:activePackage)
            if(!$removed){Write-PackageThemeStatus 'cleanup-error' $failure;throw $failure}
            Write-PackageThemeStatus 'retired' 'The previous package was removed by an update; continue arming its replacement'
        }
    }
    $script:activePackage=''
    Write-PackageThemeStatus 'stopped' 'Package debug session released'
}
function Test-ProtectedThemeEntryHook($package) {
    $key='HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\ChatGPT.exe'
    $filter=Get-Item -LiteralPath $key -ErrorAction SilentlyContinue
    $hook=Get-Item -LiteralPath "$key\CodexGlassTheme" -ErrorAction SilentlyContinue
    if(!$filter -or $filter.GetValue('UseFilter',0) -ne 1 -or !$hook){return $false}
    $image=Join-Path $package.InstallLocation 'app\ChatGPT.exe'
    $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $runtime=Join-Path $env:ProgramData "CodexThemeBridge-$sid\.runtime-ifeo"
    $relay=Join-Path $runtime 'IfeoAliasRelay.exe'
    $config=Join-Path $runtime 'chatgpt-hook-config.json'
    $expected='"'+$relay+'" --config "'+$config+'"'
    return (
        $hook.GetValue('FilterFullPath') -eq $image -and
        $hook.GetValue('Debugger') -eq $expected -and
        (Test-Path -LiteralPath $relay -PathType Leaf) -and
        (Test-Path -LiteralPath $config -PathType Leaf)
    )
}

function Sync-PackageThemeHook {
    if(!(Test-Path -LiteralPath $script:packageHookDebugger)){
        if($script:packageSession){Clear-PackageThemeHook}
        throw 'Package startup debugger is missing; package hook was cleared'
    }
    $package=Get-CodexInstalledPackage
    if(!$package){if($script:packageSession){Clear-PackageThemeHook};return}
    if(Test-ProtectedThemeEntryHook $package){
        # Package-wide debugging suspends other tools launched in the Codex
        # package, including Cockpit Tools' account-switch launcher.
        Clear-StagedThemeHook
        if($script:packageSession){Clear-PackageThemeHook -AllowRemovedPackage}
        if($script:activePackage -ne $package.PackageFullName){
            Disable-OwnedPackageThemeHook $package.PackageFullName|Out-Null
            $script:activePackage=$package.PackageFullName
            Write-PackageThemeStatus 'entry-hook' 'Protected ChatGPT entry hook supplies CDP without package-wide debugging'
        }
        return
    $staged=$script:stagedThemeHook
    if($staged -and $staged.session -and $staged.package.PackageFullName -eq $package.PackageFullName){
        if($script:packageSession){Clear-PackageThemeHook -AllowRemovedPackage}
        $script:packageSession=$staged.session
        $script:stagedThemeHook=$null
        $script:activePackage=$package.PackageFullName
        Write-PackageThemeStatus 'armed' 'Theme startup hook was prepared during package staging'
    }
    if($script:activePackage -eq $package.PackageFullName -and $script:packageSession){
        $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        $expected='"'+$script:packageHookDebugger+'" --config "'+(Join-Path $script:packageHookRuntime ('package-hooks\'+$package.PackageFullName+'.json'))+'"'
        $keys=@(('Registry::HKEY_USERS\'+$sid+'\Software\Classes\ActivatableClasses\Package\'+$package.PackageFullName+'\DebugInformation'),('Registry::HKEY_USERS\'+$sid+'\Software\Microsoft\Windows\CurrentVersion\PackagedAppXDebug\'+$package.PackageFullName))
        $found=$false
        foreach($key in $keys){if(Test-Path -LiteralPath $key){if((Get-Item -LiteralPath $key).GetValue('') -ne $expected){$script:packageSession.ReleaseWithoutDisabling();$script:packageSession=$null;$script:activePackage='';Write-PackageThemeStatus 'externally-owned' 'Package debugger changed externally; it was preserved';throw 'Package debugger changed externally; it was preserved'};$found=$true}}
        if($found){return}
        Write-CodexStartupTrace 'package-hook' 'registration-lost'
        Clear-PackageThemeHook
    }
    try{
        $imageArgument=if($staged -and $staged.package.PackageFullName -eq $package.PackageFullName){$staged.alias}else{Invoke-CodexStartupPhase 'argument-alias' {New-CodexArgumentAlias -Package $package}}
    }catch{if($script:packageSession){Clear-PackageThemeHook};throw}
    if($script:packageSession){Clear-PackageThemeHook -AllowRemovedPackage}
    $script:packageSession=New-PackageThemeSession $package $imageArgument
    $script:activePackage=$package.PackageFullName
    Write-PackageThemeStatus 'armed' 'Original packaged entry will receive loopback CDP on its next fresh activation'
}
function New-PackageThemeSession($package,[string]$imageArgument) {
    $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    # The named watcher mutex is held here. Recover our own persisted callback
    # after an abrupt process exit or Windows shutdown, preserving other tools.
    Invoke-CodexStartupPhase 'recover-owned-hook' {Disable-OwnedPackageThemeHook $package.PackageFullName|Out-Null}
    $image=Join-Path $package.InstallLocation 'app\ChatGPT.exe'
    if($package.PackageFullName -notmatch '^OpenAI\.Codex_[0-9.]+_x64__2p2nqsd0c76g0$' -or !(Test-Path -LiteralPath $image) -or !(Test-Path -LiteralPath (Join-Path $package.InstallLocation 'app\resources\app.asar'))){throw 'Official package layout or architecture is unsupported; native startup is preserved'}
    $directory=Join-Path $script:packageHookRuntime 'package-hooks'
    New-Item -ItemType Directory -Force -Path $directory|Out-Null
    $configPath=Join-Path $directory ($package.PackageFullName+'.json')
    $config=@{mode='user-main';package=$package.PackageFullName;sid=$sid;image=$image;imageArgument=$imageArgument;excludedPids=@();notBefore=[DateTime]::UtcNow.ToFileTimeUtc();expires=0;requiredProfile='';log=(Join-Path $script:packageHookRuntime 'package-debugger.jsonl')}
    [IO.File]::WriteAllText($configPath,($config|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
    Invoke-CodexStartupPhase 'enable-package-hook' {[PackageDebugSession]::new($package.PackageFullName,('"'+$script:packageHookDebugger+'" --config "'+$configPath+'"'),[IntPtr]::Zero,0)}
}
