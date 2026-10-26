$ErrorActionPreference='Stop'
$version='24.21.0'
$archiveName='node-v'+$version+'-win-x64.zip'
$vendor=Join-Path $PSScriptRoot 'vendor'
$runtime=Join-Path $vendor ('node-v'+$version+'-win-x64')
if(Test-Path -LiteralPath $runtime){throw 'Runtime cache already exists. Reuse it for the build, or choose a clean checkout to fetch it again.'}
New-Item -ItemType Directory -Path $vendor -Force|Out-Null
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
$base='https://nodejs.org/dist/v'+$version+'/'
$archive=Join-Path $vendor $archiveName
if(!(Test-Path -LiteralPath $archive)){Invoke-WebRequest -UseBasicParsing -Uri ($base+$archiveName) -OutFile $archive}
Expand-Archive -LiteralPath $archive -DestinationPath $vendor
if(!(Test-Path -LiteralPath (Join-Path $runtime 'node.exe')) -or !(Test-Path -LiteralPath (Join-Path $runtime 'LICENSE'))){throw 'The archive did not contain the expected runtime and license.'}
$actual=& (Join-Path $runtime 'node.exe') --version
if($LASTEXITCODE -ne 0 -or $actual -ne ('v'+$version)){throw 'The downloaded runtime version did not match.'}
Write-Output ('Node.js runtime: '+$runtime)
