param([string]$Version='1.1.0')
$ErrorActionPreference='Stop'
if($Version -notmatch '^\d+\.\d+\.\d+$'){throw 'Invalid release version'}
$repository=Split-Path -Parent $PSScriptRoot
$payload=Join-Path $PSScriptRoot 'payload'
$vendor=Join-Path $PSScriptRoot 'vendor\node-v24.21.0-win-x64'
if(!(Test-Path -LiteralPath (Join-Path $vendor 'node.exe'))){throw 'Run packaging/Get-NodeRuntime.ps1 to download and verify the official Node.js 24.21.0 Windows x64 runtime first.'}
$buildRoot=Join-Path $PSScriptRoot ('build\'+[guid]::NewGuid().ToString('N'))
$stage=Join-Path $buildRoot 'payload'
$dist=Join-Path $repository 'dist'
New-Item -ItemType Directory -Force -Path $stage,$dist|Out-Null
foreach($file in @(Get-ChildItem -LiteralPath $payload -File -Recurse)){
    $relative=$file.FullName.Substring($payload.Length+1)
    $destination=Join-Path $stage $relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination)|Out-Null
    if($file.Extension -eq '.ps1'){
        # Windows PowerShell 5.1 requires a BOM for UTF-8 Chinese text.
        [IO.File]::WriteAllText($destination,[IO.File]::ReadAllText($file.FullName),[Text.UTF8Encoding]::new($true))
    }else{Copy-Item -LiteralPath $file.FullName -Destination $destination}
}
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'runtime'),(Join-Path $stage 'bin')|Out-Null
Copy-Item -LiteralPath (Join-Path $vendor 'node.exe') -Destination (Join-Path $stage 'runtime\node.exe')
Copy-Item -LiteralPath (Join-Path $vendor 'LICENSE') -Destination (Join-Path $stage 'runtime\NODE-LICENSE.txt')
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /codepage:65001 /target:winexe /platform:x64 /reference:System.Web.Extensions.dll ('/out:'+(Join-Path $stage 'bin\PackageStartupDebugger.exe')) (Join-Path $stage 'StartupArguments.cs') (Join-Path $stage 'PackageStartupDebugger.cs')
if($LASTEXITCODE -ne 0){throw 'Startup helper compilation failed'}
& $compiler /nologo /target:library /platform:x64 ('/out:'+(Join-Path $stage 'bin\PackageDebugSession.dll')) (Join-Path $stage 'PackageDebugSession.cs')
if($LASTEXITCODE -ne 0){throw 'Package session compilation failed'}
& $compiler /nologo /target:exe /platform:x64 /reference:System.Windows.Forms.dll ('/out:'+(Join-Path $stage 'theme\NativeBackdropWatch.exe')) (Join-Path $stage 'theme\NativeBackdropWatch.cs')
if($LASTEXITCODE -ne 0){throw 'Native backdrop helper compilation failed'}
$files=@(Get-ChildItem -LiteralPath $stage -File -Recurse|Sort-Object FullName|ForEach-Object {
    [ordered]@{path=$_.FullName.Substring($stage.Length+1).Replace('\','/');bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
})
$manifest=[ordered]@{product='CodexGlassThemes';version=$Version;nodeVersion='24.21.0';platform='windows-x64';minimumWindowsBuild=22621;packageName='OpenAI.Codex';files=$files}
[IO.File]::WriteAllText((Join-Path $stage 'payload.json'),($manifest|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
Add-Type -AssemblyName System.IO.Compression,System.IO.Compression.FileSystem
$archive=Join-Path $buildRoot 'payload.zip'
# .NET Framework's CreateFromDirectory uses Windows backslashes in entries.
# Use portable ZIP paths explicitly, as required by the installer's validator.
$zip=[IO.Compression.ZipFile]::Open($archive,[IO.Compression.ZipArchiveMode]::Create)
try{
    foreach($file in @(Get-ChildItem -LiteralPath $stage -File -Recurse)){
        $relative=$file.FullName.Substring($stage.Length+1).Replace('\','/')
        $entry=$zip.CreateEntry($relative,[IO.Compression.CompressionLevel]::Optimal)
        $input=[IO.File]::OpenRead($file.FullName);$outputStream=$entry.Open()
        try{$input.CopyTo($outputStream)}finally{$outputStream.Dispose();$input.Dispose()}
    }
}finally{$zip.Dispose()}
$output=Join-Path $dist ('ChatGPT-Glass-Themes-Setup-'+$Version+'-win-x64.exe')
& $compiler /nologo /codepage:65001 /target:winexe /platform:x64 /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll ('/win32manifest:'+(Join-Path $PSScriptRoot 'setup.manifest')) ('/resource:'+$archive+',payload.zip') ('/out:'+$output) (Join-Path $PSScriptRoot 'Setup.cs')
if($LASTEXITCODE -ne 0){throw 'Installer compilation failed'}
$result=[ordered]@{installer=$output;bytes=(Get-Item -LiteralPath $output).Length;version=$Version;stage=$stage;payloadFiles=$files.Count;nodeVersion='24.21.0';builtAt=(Get-Date).ToString('o')}
$result|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $dist 'build-result.json') -Encoding UTF8
Copy-Item -LiteralPath (Join-Path $stage 'README.md') -Destination (Join-Path $dist '使用說明.md') -Force
$result|ConvertTo-Json
