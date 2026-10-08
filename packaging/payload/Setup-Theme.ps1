param([ValidateSet('Check','Stage','Install','Uninstall')][string]$Action='Install',[string]$InstallRoot=(Join-Path $env:USERPROFILE 'CodexGlass'))
$ErrorActionPreference='Stop'
Import-Module Microsoft.PowerShell.Utility -ErrorAction Stop
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$product='CodexGlassThemes';$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$InstallRoot=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
$marker=Join-Path $InstallRoot 'installation.json'
$runKey='Registry::HKEY_USERS\'+$sid+'\Software\Microsoft\Windows\CurrentVersion\Run'
$runName='CodexGlassThemeAutoAttach'
$uninstallKey='Registry::HKEY_USERS\'+$sid+'\Software\Microsoft\Windows\CurrentVersion\Uninstall\'+$product
$shell=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$startScript=Join-Path $InstallRoot 'Start-Theme-Auto.ps1'
$arguments='-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$startScript+'"'
$command='"'+$shell+'" '+$arguments
$mutex=[Threading.Mutex]::new($false,'Local\CodexGlassSetup-'+$sid)
if(!$mutex.WaitOne(0)){$mutex.Dispose();throw '另一個主題安裝程序正在執行。'}
$activated=$false;$runChanged=$false;$installed=$false;$previousRun=$null;$touchedRoot=$false
function Read-Json([string]$path){Get-Content -LiteralPath $path -Raw -Encoding UTF8|ConvertFrom-Json}
function Write-Json([string]$path,$value){[IO.File]::WriteAllText($path,($value|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))}
function Assert-OrdinaryPath([string]$path){
    $current=[IO.Path]::GetFullPath($path)
    while($current){
        if(Test-Path -LiteralPath $current){if((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw ('安裝路徑包含重新導向的目錄：'+$current)}}
        $parent=[IO.Path]::GetDirectoryName($current);if($parent -eq $current){break};$current=$parent
    }
}
function Assert-InstallRoot {
    $userRoot=[IO.Path]::GetFullPath($env:USERPROFILE).TrimEnd('\')+'\'
    if(!$InstallRoot.StartsWith($userRoot,[StringComparison]::OrdinalIgnoreCase)){throw '請使用目前帳戶個人資料夾內的獨立安裝目錄。'}
    Assert-OrdinaryPath $InstallRoot
    if(Test-Path -LiteralPath $marker){
        $owner=Read-Json $marker
        if($owner.product -ne $product -or $owner.sid -ne $sid -or $owner.root -ne $InstallRoot){throw '現有資料夾屬於其他安裝，已保留。'}
        if($Action -eq 'Stage'){throw '部署測試僅接受全新或空白目錄；現有安裝已保留。'}
        if($Action -eq 'Install' -and $owner.mode -eq 'Install'){throw '此版本已安裝。如需重新安裝，請先從 Windows 已安裝的應用程式解除安裝；主題偏好會保留。'}
    }elseif((Test-Path -LiteralPath $InstallRoot) -and @(Get-ChildItem -LiteralPath $InstallRoot -Force).Count){throw '安裝資料夾已有其他檔案；請使用空白的獨立資料夾。'}
}
function Get-Requirements {
    if(![Environment]::Is64BitProcess -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64'){throw '此安裝包適用 Windows x64。'}
    $os=Get-CimInstance Win32_OperatingSystem
    if([int]$os.BuildNumber -lt 19045){throw '此相容版需要 Windows 10 22H2 (19045) 或更新版本。'}
    $package=Get-AppxPackage -Name OpenAI.Codex|Where-Object {$_.Status -eq 'Ok' -and $_.PackageFullName -match '^OpenAI\.Codex_[0-9.]+_x64__2p2nqsd0c76g0$'}|Sort-Object Version -Descending|Select-Object -First 1
    if(!$package -or !(Test-Path -LiteralPath (Join-Path $package.InstallLocation 'app\ChatGPT.exe'))){throw '請先安裝官方 Windows x64 Codex 桌面版，再執行此安裝程式。'}
    $alias=Join-Path $InstallRoot '.arg\0001\ChatGPT.exe';$image=Join-Path $package.InstallLocation 'app\ChatGPT.exe'
    if($alias.Length+24 -gt $image.Length){throw '安裝路徑太長；請使用個人資料夾內較短的獨立資料夾名稱。'}
    $package
}
function Get-Payload {
    $manifest=Read-Json (Join-Path $PSScriptRoot 'payload.json')
    if($manifest.product -ne $product -or !$manifest.version -or !$manifest.files.Count){throw '安裝內容資訊不完整。'}
    $seen=@{}
    foreach($file in $manifest.files){
        $relative=[string]$file.path
        if($relative -notmatch '^[a-zA-Z0-9_./-]+$' -or $relative -match '(^|/)\.\.?(/|$)' -or $relative.StartsWith('/') -or $seen.ContainsKey($relative)){throw '安裝內容路徑無效。'}
        $seen[$relative]=$true
        $path=Join-Path $PSScriptRoot $relative
        Assert-OrdinaryPath $path
        if(!(Test-Path -LiteralPath $path -PathType Leaf) -or (Get-Item -LiteralPath $path).Length -ne $file.bytes -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $file.sha256){throw ('安裝內容損壞：'+$relative)}
    }
    $version=& (Join-Path $PSScriptRoot 'runtime\node.exe') --version
    if($LASTEXITCODE -ne 0 -or $version -ne ('v'+$manifest.nodeVersion)){throw '內附執行環境無法啟動。'}
    $manifest
}
function Assert-NoOtherInstallation($package){
    $existing=Get-ItemProperty -LiteralPath $runKey -Name $runName -ErrorAction SilentlyContinue
    if($existing -and $existing.$runName -ne $command){throw '此帳戶已有另一套自動主題助手。請先用原安裝的移除功能解除，再安裝此版本。'}
    if((Test-Path -LiteralPath $uninstallKey) -and (Get-ItemProperty -LiteralPath $uninstallKey).InstallLocation -ne $InstallRoot){throw '此帳戶已有其他位置的主題安裝紀錄，已保留。'}
    $keys=@(('Registry::HKEY_USERS\'+$sid+'\Software\Classes\ActivatableClasses\Package\'+$package.PackageFullName+'\DebugInformation'),('Registry::HKEY_USERS\'+$sid+'\Software\Microsoft\Windows\CurrentVersion\PackagedAppXDebug\'+$package.PackageFullName))
    $expected='"'+(Join-Path $InstallRoot 'bin\PackageStartupDebugger.exe')+'" --config "'+(Join-Path $InstallRoot ('.runtime-auto\package-hooks\'+$package.PackageFullName+'.json'))+'"'
    foreach($key in $keys){if((Test-Path -LiteralPath $key) -and (Get-Item -LiteralPath $key).GetValue('') -ne $expected){throw '官方程式已有其他啟動除錯設定，已保留。請先移除該設定再安裝。'}}
    if($Action -eq 'Install'){
        $guard=[Threading.Mutex]::new($false,'Local\CodexGlassThemeAutoAttach')
        try{if(!$guard.WaitOne(0)){throw '另一個主題助手仍在執行，已保留。'};$guard.ReleaseMutex()}finally{$guard.Dispose()}
    }
}
function Stop-OwnedProcess([string]$pidFile,[string]$script,[string]$stopFile){
    if(!(Test-Path -LiteralPath $pidFile)){return}
    $processId=0;if(![int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(),[ref]$processId)){throw '助手程序紀錄無效，已保留。'}
    $candidate=Get-CimInstance Win32_Process -Filter ('ProcessId='+$processId) -ErrorAction SilentlyContinue
    if(!$candidate){return}
    if($candidate.CommandLine.IndexOf(('"'+$script+'"'),[StringComparison]::OrdinalIgnoreCase) -lt 0 -or (Invoke-CimMethod -InputObject $candidate -MethodName GetOwnerSid).Sid -ne $sid){throw '助手程序身分不符，已保留。'}
    [IO.File]::WriteAllText($stopFile,'stop')
    $deadline=[DateTime]::UtcNow.AddSeconds(30)
    do{Start-Sleep -Milliseconds 250;$alive=Get-CimInstance Win32_Process -Filter ('ProcessId='+$processId) -ErrorAction SilentlyContinue}while($alive -and $alive.CreationDate -eq $candidate.CreationDate -and [DateTime]::UtcNow -lt $deadline)
    if($alive -and $alive.CreationDate -eq $candidate.CreationDate){throw '助手尚未正常退出，檔案已保留。請稍後重試。'}
}
function Stop-OwnedHelpers {
    Stop-OwnedProcess (Join-Path $InstallRoot '.runtime-auto\watcher.pid') $startScript (Join-Path $InstallRoot '.runtime-auto\stop')
    Stop-OwnedProcess (Join-Path $InstallRoot 'theme\.runtime\host.pid') (Join-Path $InstallRoot 'theme\theme-host.mjs') (Join-Path $InstallRoot 'theme\.runtime\stop')
    $guard=[Threading.Mutex]::new($false,'Local\CodexGlassThemeAutoAttach')
    try{if(!$guard.WaitOne(0)){throw '另一個主題助手仍在執行，已保留。'};$guard.ReleaseMutex()}finally{$guard.Dispose()}
}
function Clear-OwnedHook {
    foreach($package in @(Get-AppxPackage -Name OpenAI.Codex)){
        $keys=@(('Registry::HKEY_USERS\'+$sid+'\Software\Classes\ActivatableClasses\Package\'+$package.PackageFullName+'\DebugInformation'),('Registry::HKEY_USERS\'+$sid+'\Software\Microsoft\Windows\CurrentVersion\PackagedAppXDebug\'+$package.PackageFullName))
        $expected='"'+(Join-Path $InstallRoot 'bin\PackageStartupDebugger.exe')+'" --config "'+(Join-Path $InstallRoot ('.runtime-auto\package-hooks\'+$package.PackageFullName+'.json'))+'"'
        $owned=$false
        foreach($key in $keys){if(Test-Path -LiteralPath $key){if((Get-Item -LiteralPath $key).GetValue('') -ne $expected){throw '其他啟動除錯設定已保留。'};$owned=$true}}
        if($owned){
            $dll=Join-Path $InstallRoot 'bin\PackageDebugSession.dll';if(!(Test-Path -LiteralPath $dll)){$dll=Join-Path $PSScriptRoot 'bin\PackageDebugSession.dll'}
            if(!('PackageDebugSession' -as [type])){[Reflection.Assembly]::Load([IO.File]::ReadAllBytes($dll))|Out-Null}
            [PackageDebugSession]::Disable($package.PackageFullName)
            foreach($key in $keys){if(Test-Path -LiteralPath $key){throw '啟動回呼尚未清除，檔案已保留。'}}
        }
    }
}
function Start-IndependentWatcher($package){
    $taskName='CodexGlassTheme-Install-'+[guid]::NewGuid().ToString('N');$ready=$false;$registered=$false;$started=[DateTime]::UtcNow
    try{
        $action=New-ScheduledTaskAction -Execute $shell -Argument $arguments -WorkingDirectory $InstallRoot
        $principal=New-ScheduledTaskPrincipal -UserId $sid -LogonType Interactive -RunLevel Limited
        $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings|Out-Null;$registered=$true;Start-ScheduledTask -TaskName $taskName
        $deadline=[DateTime]::UtcNow.AddSeconds(25)
        do{
            $statusPath=Join-Path $InstallRoot '.runtime-auto\package-hook-status.json'
            if(Test-Path -LiteralPath $statusPath){
                $status=Read-Json $statusPath
                $candidate=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$status.workerPid) -ErrorAction SilentlyContinue
                if($candidate -and $candidate.CreationDate.ToUniversalTime() -ge $started -and $candidate.CommandLine.IndexOf(('"'+$startScript+'"'),[StringComparison]::OrdinalIgnoreCase) -ge 0 -and $status.state -eq 'armed' -and $status.package -eq $package.PackageFullName -and (Invoke-CimMethod -InputObject $candidate -MethodName GetOwnerSid).Sid -eq $sid){$ready=$true}
            }
            if(!$ready){Start-Sleep -Milliseconds 250}
        }while(!$ready -and [DateTime]::UtcNow -lt $deadline)
        if(!$ready){throw '主題助手未在期限內就緒；請查看安裝資料夾的 .runtime-auto\auto.log。'}
        $status
    }finally{if($registered){Unregister-ScheduledTask -TaskName $taskName -Confirm:$false}}
}
function Assert-RemovalTree([string]$directory){
    foreach($entry in @(Get-ChildItem -LiteralPath $directory -Force)){
        if($entry.Attributes -band [IO.FileAttributes]::ReparsePoint){
            if($entry.LinkType -ne 'Junction' -or $entry.Parent.FullName -ne (Join-Path $InstallRoot '.arg')){throw '發現非預期的重新導向項目，已保留。'}
            $aliasOwner=Read-Json (Join-Path $InstallRoot '.arg\argument-alias-owner.json')
            if($aliasOwner.sid -ne $sid -or $aliasOwner.project -ne $InstallRoot){throw '版本別名屬於其他安裝，已保留。'}
        }elseif($entry.PSIsContainer){Assert-RemovalTree $entry.FullName}
    }
}
function Remove-OwnedTree([string]$directory){
    # Called only after validating installation.json against this account/root.
    $full=[IO.Path]::GetFullPath($directory)
    if($full -ne $InstallRoot -and !$full.StartsWith($InstallRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw '拒絕刪除安裝目錄之外的路徑。'}
    foreach($entry in @(Get-ChildItem -LiteralPath $full -Force)){
        if($entry.Attributes -band [IO.FileAttributes]::ReparsePoint){
            if($entry.LinkType -ne 'Junction' -or $entry.Parent.FullName -ne (Join-Path $InstallRoot '.arg')){throw '發現非預期的重新導向項目，已保留。'}
            [IO.Directory]::Delete($entry.FullName)
        }elseif($entry.PSIsContainer){Remove-OwnedTree $entry.FullName}
        else{Remove-Item -LiteralPath $entry.FullName -Force}
    }
    [IO.Directory]::Delete($full)
}
try{
    Assert-InstallRoot
    if($Action -eq 'Uninstall'){
        if(!(Test-Path -LiteralPath $marker)){throw '找不到此帳戶的安裝資訊。'}
        Assert-RemovalTree $InstallRoot
        $existing=Get-ItemProperty -LiteralPath $runKey -Name $runName -ErrorAction SilentlyContinue
        if($existing -and $existing.$runName -ne $command){throw '登入設定已由其他程式變更，已保留。'}
        if((Test-Path -LiteralPath $uninstallKey) -and (Get-ItemProperty -LiteralPath $uninstallKey).InstallLocation -ne $InstallRoot){throw '解除安裝紀錄屬於其他安裝，已保留。'}
        $backup=Join-Path $InstallRoot '.runtime-auto\startup-backup.json'
        if($existing -and !(Test-Path -LiteralPath $backup)){throw '登入設定備份遺失，已保留安裝檔案。'}
        if(Test-Path -LiteralPath $backup){$original=Read-Json $backup;if($original.command -ne $command){throw '登入設定備份不屬於此安裝，已保留。'}}
        Stop-OwnedHelpers;Clear-OwnedHook
        if(Test-Path -LiteralPath $backup){$original=Read-Json $backup;if($original.existed){New-ItemProperty -LiteralPath $runKey -Name $runName -Value $original.value -PropertyType String -Force|Out-Null}else{Remove-ItemProperty -LiteralPath $runKey -Name $runName -ErrorAction SilentlyContinue}}
        elseif($existing){throw '登入設定備份遺失，已保留安裝檔案。'}
        if(Test-Path -LiteralPath $uninstallKey){if((Get-ItemProperty -LiteralPath $uninstallKey).InstallLocation -ne $InstallRoot){throw '解除安裝紀錄屬於其他安裝，已保留。'};Remove-Item -LiteralPath $uninstallKey}
        $cleanupRoot=$InstallRoot
        Set-Location -LiteralPath $env:TEMP
        Remove-OwnedTree $cleanupRoot
        Write-Output '{"ok":true,"action":"Uninstall","preferencesPreserved":true}'
        exit 0
    }
    $package=Get-Requirements
    Write-Output '正在檢查內附執行環境與主題檔案…'
    $manifest=Get-Payload
    if($Action -ne 'Stage'){Assert-NoOtherInstallation $package}
    if($Action -eq 'Check'){[ordered]@{ok=$true;action=$Action;package=$package.PackageFullName;root=$InstallRoot;files=$manifest.files.Count;nodeVersion=$manifest.nodeVersion}|ConvertTo-Json -Compress;exit 0}
    # Recover only this incomplete installation's own persisted callback before
    # replacing its helper. Completed installations are rejected above.
    if($Action -eq 'Install' -and (Test-Path -LiteralPath $marker)){Stop-OwnedHelpers;Clear-OwnedHook}
    Write-Output '正在安裝主題與背景助手…'
    New-Item -ItemType Directory -Path $InstallRoot -Force|Out-Null
    $touchedRoot=$true
    Write-Json $marker @{product=$product;version=$manifest.version;sid=$sid;root=$InstallRoot;mode=$(if($Action -eq 'Stage'){'Stage'}else{'Preparing'});installedAt=(Get-Date).ToString('o')}
    foreach($file in $manifest.files){$target=Join-Path $InstallRoot $file.path;Assert-OrdinaryPath $target;New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target)|Out-Null;Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file.path) -Destination $target -Force}
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'payload.json') -Destination (Join-Path $InstallRoot 'payload.json') -Force
    if($Action -eq 'Stage'){[ordered]@{ok=$true;action=$Action;root=$InstallRoot;files=$manifest.files.Count;systemSettingsChanged=$false}|ConvertTo-Json -Compress;exit 0}
    $runtime=Join-Path $InstallRoot '.runtime-auto';New-Item -ItemType Directory -Force -Path $runtime|Out-Null
    $backupPath=Join-Path $runtime 'startup-backup.json'
    $previousRun=Get-ItemProperty -LiteralPath $runKey -Name $runName -ErrorAction SilentlyContinue
    if(!(Test-Path -LiteralPath $backupPath)){if($previousRun){throw '登入備份遺失，已保留現有設定。'};Write-Json $backupPath @{existed=$false;value=$null;command=$command}}
    Write-Output '正在啟用登入自動啟動…'
    New-ItemProperty -LiteralPath $runKey -Name $runName -Value $command -PropertyType String -Force|Out-Null;$runChanged=$true
    $activated=$true;$status=Start-IndependentWatcher $package
    New-Item -Path $uninstallKey -Force|Out-Null
    $uninstallCommand='"'+$shell+'" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $InstallRoot 'Setup-Theme.ps1')+'" -Action Uninstall -InstallRoot "'+$InstallRoot+'"'
    @{DisplayName='ChatGPT Glass Themes（Codex）';DisplayVersion=$manifest.version;Publisher='Codex Glass Themes';InstallLocation=$InstallRoot;UninstallString=$uninstallCommand}|ForEach-Object {foreach($key in $_.Keys){New-ItemProperty -LiteralPath $uninstallKey -Name $key -Value $_[$key] -PropertyType String -Force|Out-Null}}
    New-ItemProperty -LiteralPath $uninstallKey -Name NoModify -Value 1 -PropertyType DWord -Force|Out-Null
    New-ItemProperty -LiteralPath $uninstallKey -Name NoRepair -Value 1 -PropertyType DWord -Force|Out-Null
    Write-Json $marker @{product=$product;version=$manifest.version;sid=$sid;root=$InstallRoot;mode='Install';installedAt=(Get-Date).ToString('o')}
    $installed=$true
    [ordered]@{ok=$true;action=$Action;root=$InstallRoot;package=$package.PackageFullName;watcherPid=$status.workerPid;state=$status.state;restartRequired=[bool]@(Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'"|Where-Object CommandLine -notmatch '--type=')}|ConvertTo-Json -Compress
}catch{
    $failure=$_.Exception.Message;$rollbackError=$null
    if($Action -eq 'Install' -and !$installed){
        $rollbackFailures=@()
        if($activated){try{Stop-OwnedHelpers;Clear-OwnedHook}catch{$rollbackFailures+=$_.Exception.Message}}
        if($runChanged){try{if($previousRun){New-ItemProperty -LiteralPath $runKey -Name $runName -Value $previousRun.$runName -PropertyType String -Force|Out-Null}else{Remove-ItemProperty -LiteralPath $runKey -Name $runName -ErrorAction SilentlyContinue}}catch{$rollbackFailures+=$_.Exception.Message}}
        if($rollbackFailures.Count){$rollbackError=$rollbackFailures -join '; '}
        if($touchedRoot -and (Test-Path -LiteralPath $marker)){Write-Json $marker @{product=$product;version=$manifest.version;sid=$sid;root=$InstallRoot;mode='Failed';error=$failure;installedAt=(Get-Date).ToString('o')}}
    }
    [ordered]@{ok=$false;action=$Action;error=$failure;rollbackError=$rollbackError}|ConvertTo-Json -Compress|Write-Output
    exit 1
}finally{$mutex.ReleaseMutex();$mutex.Dispose()}
