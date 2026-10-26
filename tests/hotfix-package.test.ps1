$ErrorActionPreference='Stop'
$repository=Split-Path -Parent $PSScriptRoot
$reportRoot=Join-Path $repository ('experiments\helper-hotfix-smoke-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $reportRoot|Out-Null
$extracted=Join-Path $reportRoot 'extracted'
$staged=Join-Path $env:USERPROFILE ('CGT-Hotfix-Test-'+[guid]::NewGuid().ToString('N').Substring(0,8))
$installer=Join-Path $repository 'dist\ChatGPT-Glass-Themes-Setup-2.0.1-win-x64.exe'
$process=Start-Process -FilePath $installer -ArgumentList @('--extract-only',('"'+$extracted+'"')) -WindowStyle Hidden -Wait -PassThru
if($process.ExitCode -ne 0){throw 'Installer extraction failed'}
$manifest=Get-Content -LiteralPath (Join-Path $extracted 'payload.json') -Raw|ConvertFrom-Json
if($manifest.version -ne '2.0.1' -or $manifest.files.Count -ne 45){throw 'Unexpected package contents'}
foreach($relative in @('theme\token-feed.mjs','theme\host-lease.mjs','Get-ThemeHelperProcess.ps1','Start-Theme-Auto.ps1')){
    if([IO.File]::ReadAllText((Join-Path $extracted $relative)).Replace("`r`n","`n") -ne [IO.File]::ReadAllText((Join-Path $repository ('packaging\payload\'+$relative))).Replace("`r`n","`n")){throw ('Packaged source mismatch: '+$relative)}
}
$process=Start-Process -FilePath $installer -ArgumentList @('--stage-only','--install-root',('"'+$staged+'"')) -WindowStyle Hidden -Wait -PassThru
if($process.ExitCode -ne 0){throw 'Installer isolated stage failed'}
$marker=Get-Content -LiteralPath (Join-Path $staged 'installation.json') -Raw|ConvertFrom-Json
if($marker.mode -ne 'Stage' -or $marker.version -ne '2.0.1'){throw 'Stage identity mismatch'}
$node=Join-Path $staged 'runtime\node.exe'
foreach($relative in @('theme\theme-host.mjs','theme\host-lease.mjs','theme\token-feed.mjs')){
    & $node --check (Join-Path $staged $relative)
    if($LASTEXITCODE -ne 0){throw ('Staged syntax failure: '+$relative)}
}
$result=[ordered]@{passed=$true;version=$manifest.version;payloadFiles=$manifest.files.Count;checks=@('installer extraction','packaged source matches','isolated stage','bundled Node syntax');reportRoot=$reportRoot;stagedRoot=$staged}
$result|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $reportRoot 'result.json') -Encoding UTF8
$result|ConvertTo-Json
