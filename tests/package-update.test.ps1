$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\packaging\payload\Package-Theme-Hook.ps1')
function Get-AppxPackage { param($Name) $script:installedPackages }
function Write-PackageThemeStatus { param($state,$message) $script:lastStatus=$state }
function New-FakeSession($failure){
    $session=[pscustomobject]@{CleanupError=$failure;Disposed=$false}
    $session|Add-Member ScriptMethod Dispose {$this.Disposed=$true}
    $session
}
$old='OpenAI.Codex_26.930.7945.0_x64__2p2nqsd0c76g0'
$new='OpenAI.Codex_26.1002.7124.0_x64__2p2nqsd0c76g0'
$script:installedPackages=@([pscustomobject]@{PackageFullName=$new})
$script:activePackage=$old
$held=New-FakeSession 'DisableDebugging HRESULT -2147023728'
$script:packageSession=$held
Clear-PackageThemeHook -AllowRemovedPackage
if(!$held.Disposed -or $script:packageSession -or $script:activePackage){throw 'Removed package did not release its old session'}
foreach($scenario in @('still-installed','other-error','strict-cleanup')){
    $script:activePackage=$old
    $script:installedPackages=if($scenario -eq 'still-installed'){@([pscustomobject]@{PackageFullName=$old})}else{@()}
    $failure=if($scenario -eq 'other-error'){'DisableDebugging HRESULT -2147024891'}else{'DisableDebugging HRESULT -2147023728'}
    $script:packageSession=New-FakeSession $failure
    $rejected=$false
    try{Clear-PackageThemeHook -AllowRemovedPackage:($scenario -ne 'strict-cleanup')}catch{$rejected=$true}
    if(!$rejected){throw ('Cleanup error was hidden: '+$scenario)}
}
Write-Output 'Package update recovery checks passed (4 cases).'
