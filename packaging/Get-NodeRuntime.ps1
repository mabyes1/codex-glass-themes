$ErrorActionPreference='Stop'
$version='24.21.0'
$archiveName='node-v'+$version+'-win-x64.zip'
$expected='158F7685B44DE51F6C0DF1D153526CBCD3E1BC739A8DFC607721CEF75DE9E541'
$vendor=Join-Path $PSScriptRoot 'vendor'
$runtime=Join-Path $vendor ('node-v'+$version+'-win-x64')
if(Test-Path -LiteralPath $runtime){throw 'Runtime cache already exists. Reuse it for the build, or choose a clean checkout to fetch it again.'}
New-Item -ItemType Directory -Path $vendor -Force|Out-Null
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
$base='https://nodejs.org/dist/v'+$version+'/'
$sums=Join-Path $vendor 'SHASUMS256.txt'
$archive=Join-Path $vendor $archiveName
Invoke-WebRequest -UseBasicParsing -Uri ($base+'SHASUMS256.txt') -OutFile $sums
$entry=@(Get-Content -LiteralPath $sums|Where-Object {$_ -match ('^[a-fA-F0-9]{64}\s+'+[regex]::Escape($archiveName)+'$')})
if($entry.Count -ne 1 -or ($entry[0] -split '\s+')[0] -ne $expected){throw 'Official Node.js checksum manifest did not match the pinned archive.'}
if(!(Test-Path -LiteralPath $archive)){Invoke-WebRequest -UseBasicParsing -Uri ($base+$archiveName) -OutFile $archive}
if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expected){throw 'Node.js archive integrity check failed.'}
Expand-Archive -LiteralPath $archive -DestinationPath $vendor
if(!(Test-Path -LiteralPath (Join-Path $runtime 'node.exe')) -or !(Test-Path -LiteralPath (Join-Path $runtime 'LICENSE'))){throw 'The verified archive did not contain the expected runtime and license.'}
Write-Output ('Verified Node.js runtime: '+$runtime)
