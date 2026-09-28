$ErrorActionPreference='Stop'
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if(!(Test-Path $compiler)){throw 'The .NET Framework C# compiler was not found.'}
$script=Join-Path $PSScriptRoot 'Theme-Switcher.ps1'
$desktop=[Environment]::GetFolderPath('DesktopDirectory')
if(!(Test-Path $script) -or !(Test-Path $desktop)){throw 'The theme script or Desktop folder was not found.'}
$runtime=Join-Path $PSScriptRoot '.runtime'
New-Item -ItemType Directory -Force $runtime | Out-Null
$source=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'GlassLauncher.cs') -Raw -Encoding UTF8
$source=$source.Replace('__SCRIPT_PATH__',$script.Replace('"','""'))
$generated=Join-Path $runtime 'GlassLauncher.local.cs'
[System.IO.File]::WriteAllText($generated,$source,[System.Text.UTF8Encoding]::new($false))
$launcher=Join-Path $desktop 'Codex Glass Themes.exe'
$arguments=@('/nologo','/target:winexe','/codepage:65001','/reference:System.Windows.Forms.dll',('/out:'+$launcher))
$package=Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue | Select-Object -First 1
if($package){
    $icon=Join-Path $package.InstallLocation 'app/resources/chatgpt-app-light.ico'
    if(Test-Path $icon){$arguments+=('/win32icon:'+$icon)}
}
$arguments+=$generated
& $compiler @arguments
if($LASTEXITCODE -ne 0 -or !(Test-Path $launcher)){throw 'Could not build the desktop launcher.'}
Write-Output $launcher
