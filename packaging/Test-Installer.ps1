param([string]$Installer)
$ErrorActionPreference='Stop'
$repository=Split-Path -Parent $PSScriptRoot
if(!$Installer){$Installer=(Get-Content -LiteralPath (Join-Path $repository 'dist\build-result.json') -Raw -Encoding UTF8|ConvertFrom-Json).installer}
$suffix=[guid]::NewGuid().ToString('N').Substring(0,6)
$reportRoot=Join-Path $repository ('experiments\installer-'+$suffix)
$testRoot=Join-Path $env:USERPROFILE ('CGT-Test-'+$suffix)
New-Item -ItemType Directory -Path $reportRoot|Out-Null
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$runKey='Registry::HKEY_USERS\'+$sid+'\Software\Microsoft\Windows\CurrentVersion\Run'
$runName='CodexGlassThemeAutoAttach'
$beforeRun=(Get-ItemProperty -LiteralPath $runKey -Name $runName -ErrorAction SilentlyContinue).$runName
$beforeWatcher=$null
if($beforeRun -and $beforeRun -match '-File\s+"([^"]+Start-Theme-Auto\.ps1)"'){
    $statusPath=Join-Path (Split-Path -Parent $Matches[1]) '.runtime-auto\package-hook-status.json'
    if(Test-Path -LiteralPath $statusPath){
        $watcherStatus=Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8|ConvertFrom-Json
        $beforeWatcher=Get-CimInstance Win32_Process -Filter ('ProcessId='+$watcherStatus.workerPid)
    }
}
$checks=[ordered]@{}
function Run-Installer([string]$name,[string]$arguments,[int]$expected=0){
    $stdout=Join-Path $reportRoot ($name+'.stdout.txt');$stderr=Join-Path $reportRoot ($name+'.stderr.txt')
    $info=[Diagnostics.ProcessStartInfo]::new($Installer,$arguments)
    $info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
    $info.StandardOutputEncoding=[Text.UTF8Encoding]::new($false);$info.StandardErrorEncoding=[Text.UTF8Encoding]::new($false)
    $process=[Diagnostics.Process]::Start($info)
    $outTask=$process.StandardOutput.ReadToEndAsync();$errorTask=$process.StandardError.ReadToEndAsync()
    if(!$process.WaitForExit(45000)){throw ('Installer check timed out: '+$name)}
    $text=$outTask.Result;[IO.File]::WriteAllText($stdout,$text);[IO.File]::WriteAllText($stderr,$errorTask.Result)
    if($process.ExitCode -ne $expected){throw ($name+' returned '+$process.ExitCode+': '+$text+$errorTask.Result)}
    $checks[$name]=$true;$text
}
try{
    $extracted=Join-Path $reportRoot 'extracted'
    Run-Installer 'extract' ('--extract-only "'+$extracted+'"')|Out-Null
    $manifest=Get-Content -LiteralPath (Join-Path $extracted 'payload.json') -Raw -Encoding UTF8|ConvertFrom-Json
    if($manifest.nodeVersion -ne '24.21.0' -or @($manifest.files|Where-Object path -match '(^|/)(\.arg|\.runtime|\.runtime-auto|installation\.json)').Count){throw 'Payload included private runtime data'}
    $textFiles=@(Get-ChildItem -LiteralPath $extracted -File -Recurse|Where-Object Extension -in @('.ps1','.mjs','.js','.cs','.md','.json'))
    foreach($file in $textFiles){if([IO.File]::ReadAllText($file.FullName) -match '(?i)[a-z]:\\Users\\[^\\\s"<>]+\\|S-1-5-21-\d+-\d+-\d+-\d+'){throw ('Personal source path or SID leaked: '+$file.Name)}}
    $checks.noPersonalPathsOrRuntime=$true
    Run-Installer 'stage' ('--stage-only --install-root "'+$testRoot+'"')|Out-Null
    $node=Join-Path $testRoot 'runtime\node.exe'
    $capabilities=& $node -p 'JSON.stringify({node:process.version,websocket:typeof WebSocket,fetch:typeof fetch})'
    if($LASTEXITCODE -ne 0 -or ($capabilities|ConvertFrom-Json).websocket -ne 'function'){throw 'Bundled runtime capabilities are incomplete'}
    foreach($file in @(Get-ChildItem -LiteralPath (Join-Path $testRoot 'theme') -File|Where-Object Extension -in @('.mjs','.js'))){& $node --check $file.FullName;if($LASTEXITCODE -ne 0){throw ('Bundled JavaScript failed syntax check: '+$file.Name)}}
    $checks.bundledNodeAndThemeSyntax=$true
    $nativeTest=Join-Path $reportRoot 'native-smoke.mjs'
    @'
import {startBackdropWatch} from 'THEME_MODULE';
const watch=await startBackdropWatch(process.argv[2],process.argv[2],null,()=>{},()=>{});
try {const stats=await watch.stats();if(!stats)throw Error('No native helper response');console.log(JSON.stringify({ok:true,stats}));}finally{await watch.stop();}
'@.Replace('THEME_MODULE',([uri](Join-Path $testRoot 'theme\native-watch.mjs')).AbsoluteUri)|Set-Content -LiteralPath $nativeTest -Encoding UTF8
    & $node $nativeTest (Join-Path $testRoot 'theme');if($LASTEXITCODE -ne 0){throw 'Native helper smoke failed'}
    $checks.nativeBackdropHelper=$true
    # Read-only proof that the helper resolves the OS package path dynamically.
    $assembly=[Reflection.Assembly]::Load([IO.File]::ReadAllBytes((Join-Path $testRoot 'bin\PackageStartupDebugger.exe')))
    $method=$assembly.GetType('PackageStartupDebugger').GetMethod('GetPackagePathByFullName',[Reflection.BindingFlags]'NonPublic,Static')
    $package=Get-AppxPackage -Name OpenAI.Codex|Where-Object Status -eq 'Ok'|Sort-Object Version -Descending|Select-Object -First 1
    [object[]]$call=@($package.PackageFullName,[uint32]0,$null)
    if($method.Invoke($null,$call) -ne 122){throw 'Package path size query failed'}
    $call[2]=[Text.StringBuilder]::new([int]$call[1])
    if($method.Invoke($null,$call) -ne 0 -or $call[2].ToString() -ne $package.InstallLocation){throw 'Actual official package path did not match'}
    $checks.dynamicPackagePathApi=$true
    if($beforeRun){
        $conflict=Run-Installer 'preserveOtherInstallation' ('--check-only --install-root "'+$testRoot+'"') 1
        if($conflict -notmatch '另一套自動主題助手'){throw 'Conflict rejection was for an unexpected reason'}
    }else{
        Run-Installer 'environmentCheck' ('--check-only --install-root "'+$testRoot+'"')|Out-Null
    }
    $marker=Join-Path $testRoot 'installation.json';$owner=Get-Content -LiteralPath $marker -Raw -Encoding UTF8|ConvertFrom-Json;$owner.mode='Install';$owner|ConvertTo-Json|Set-Content -LiteralPath $marker -Encoding UTF8
    $beforeWrite=(Get-Item -LiteralPath (Join-Path $testRoot 'bin\PackageStartupDebugger.exe')).LastWriteTimeUtc
    Run-Installer 'stageRefusesInstalledRoot' ('--stage-only --install-root "'+$testRoot+'"') 1|Out-Null
    Run-Installer 'reinstallPreservesInstalledRoot' ('--silent --install-root "'+$testRoot+'"') 1|Out-Null
    if((Get-Item -LiteralPath (Join-Path $testRoot 'bin\PackageStartupDebugger.exe')).LastWriteTimeUtc -ne $beforeWrite){throw 'Protected installation file was overwritten'}
    $checks.installedPayloadPreserved=$true
    $owner.mode='Stage';$owner|ConvertTo-Json|Set-Content -LiteralPath $marker -Encoding UTF8
    # Model two official versions; remove the first target to leave a dangling
    # junction, then ensure the next version gets a different numeric slot.
    $oldPackage=Join-Path $reportRoot 'official-version-one-long-package-directory'
    $newPackage=Join-Path $reportRoot 'official-version-two-long-package-directory'
    foreach($location in @($oldPackage,$newPackage)){
        New-Item -ItemType Directory -Path (Join-Path $location 'app\resources') -Force|Out-Null
        [IO.File]::WriteAllText((Join-Path $location 'app\ChatGPT.exe'),'fixture')
        [IO.File]::WriteAllText((Join-Path $location 'app\resources\app.asar'),'fixture')
    }
    . (Join-Path $testRoot 'New-CodexArgumentAlias.ps1')
    $fake=[pscustomobject]@{PackageFullName='OpenAI.Codex_999.0.0.0_x64__2p2nqsd0c76g0';InstallLocation=$oldPackage}
    $oldAlias=New-CodexArgumentAlias -Package $fake
    if([IO.Path]::GetFullPath($oldPackage) -ne (Join-Path $reportRoot 'official-version-one-long-package-directory')){throw 'Fixture removal path mismatch'}
    Remove-Item -LiteralPath $oldPackage -Recurse -Force
    $fake.InstallLocation=$newPackage;$newAlias=New-CodexArgumentAlias -Package $fake
    if($oldAlias -eq $newAlias -or $newAlias -notmatch '\\0002\\ChatGPT.exe$'){throw 'Dangling alias slot was reused'}
    $checks.danglingVersionAliasRecovery=$true
    # Exercise the real uninstall tree functions, without COM or registry writes.
    $tokens=$null;$parseErrors=$null
    $ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $testRoot 'Setup-Theme.ps1'),[ref]$tokens,[ref]$parseErrors)
    foreach($name in @('Read-Json','Assert-OrdinaryPath','Assert-InstallRoot','Assert-RemovalTree','Remove-OwnedTree')){
        $definition=$ast.Find({param($node)$node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true)
        if(!$definition){throw ('Missing uninstall function '+$name)};Invoke-Expression $definition.Extent.Text
    }
    $InstallRoot=$testRoot;$product='CodexGlassThemes';$Action='Check'
    Assert-InstallRoot;Assert-RemovalTree $testRoot;Remove-OwnedTree $testRoot
    if(Test-Path -LiteralPath $testRoot){throw 'Owned test installation was not removed'}
    if(!(Test-Path -LiteralPath (Join-Path $newPackage 'app\ChatGPT.exe'))){throw 'Uninstall followed a junction into its target'}
    $checks.uninstallUnlinksWithoutFollowing=$true
    $afterRun=(Get-ItemProperty -LiteralPath $runKey -Name $runName -ErrorAction SilentlyContinue).$runName
    if($afterRun -ne $beforeRun){throw 'The current login startup setting changed'}
    if($beforeWatcher){
        $afterWatcher=Get-CimInstance Win32_Process -Filter ('ProcessId='+$beforeWatcher.ProcessId)
        if(!$afterWatcher -or $afterWatcher.CreationDate -ne $beforeWatcher.CreationDate){throw 'The current working watcher changed'}
    }
    $checks.currentWorkingInstallationPreserved=$true
    $result=[ordered]@{ok=$true;checks=$checks;payloadFiles=$manifest.files.Count;installer=$Installer;testInstallRemoved=$true;secondComputerInstallTested=$false;checkedAt=(Get-Date).ToString('o')}
    $result|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $repository 'dist\installer-verification.json') -Encoding UTF8
    $result|ConvertTo-Json -Depth 5
}catch{[ordered]@{ok=$false;checks=$checks;testRoot=$testRoot;error=$_.Exception.Message}|ConvertTo-Json -Depth 5;throw}
