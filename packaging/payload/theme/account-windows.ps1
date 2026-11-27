param([Parameter(Mandatory)][ValidateSet('protect','unprotect','inspect','activate','browser','commit')][string]$Action)
$ErrorActionPreference='Stop'
try {
    if($Action -in 'protect','unprotect'){
        Add-Type -AssemblyName System.Security
        $bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
        $scope=[Security.Cryptography.DataProtectionScope]::CurrentUser
        $result=if($Action -eq 'protect'){
            [Security.Cryptography.ProtectedData]::Protect($bytes,$null,$scope)
        }else{
            [Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,$scope)
        }
        [Console]::Out.Write([Convert]::ToBase64String($result))
        exit 0
    }
    if($Action -eq 'browser'){
        $url=[Uri]([Console]::In.ReadToEnd())
        if($url.Scheme -ne 'https' -or $url.Host -ne 'auth.openai.com' -or !$url.IsDefaultPort -or $url.UserInfo){exit 1}
        Start-Process -FilePath $url.AbsoluteUri
        exit 0
    }
    if($Action -eq 'inspect'){
        $session=(Get-Process -Id $PID).SessionId
        $list=@(Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe' OR Name='codex.exe'" | Where-Object SessionId -eq $session)
        $mains=@($list | Where-Object {
            $_.Name -eq 'ChatGPT.exe' -and $_.ExecutablePath -match '\\WindowsApps\\OpenAI\.Codex_[^\\]+\\app\\ChatGPT\.exe$' -and
            $_.CommandLine -and $_.CommandLine -notmatch '--type='
        } | ForEach-Object { [int]$_.ProcessId })
        $desktopServers=@($list | Where-Object {
            $_.Name -eq 'codex.exe' -and $_.ExecutablePath -match '\\WindowsApps\\OpenAI\.Codex_[^\\]+\\app\\resources\\codex\.exe$'
        } | ForEach-Object { [int]$_.ProcessId })
        $package=Get-AppxPackage -Name OpenAI.Codex | Where-Object PackageFamilyName -eq 'OpenAI.Codex_2p2nqsd0c76g0' | Select-Object -First 1
        $cli=if($package){Join-Path $package.InstallLocation 'app\resources\codex.exe'}
        @{mains=$mains;desktopServers=$desktopServers;cli=$cli} | ConvertTo-Json -Compress
        exit 0
    }
    if($Action -eq 'commit'){
        $request=ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd())
        $homePath=[IO.Path]::GetFullPath([string]$request.home)
        $authFile=Join-Path $homePath 'auth.json'
        $pending=Join-Path $homePath ('auth.json.theme-'+[guid]::NewGuid().ToString('N')+'.tmp')
        $share=[IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete
        $lock=[IO.File]::Open((Join-Path $homePath 'auth.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,$share)
        try {
            # The native Codex commit uses an exclusive byte-range lock on this same sidecar.
            $deadline=[DateTime]::UtcNow.AddSeconds(2)
            while($true){
                try{$lock.Lock(0,[long]::MaxValue);break}
                catch [IO.IOException]{
                    if(($_.Exception.HResult -band 0xffff) -ne 33){throw}
                    if([DateTime]::UtcNow -ge $deadline){[Console]::Out.Write('busy');exit 0}
                    Start-Sleep -Milliseconds 100
                }
            }
            $item=Get-Item -LiteralPath $authFile
            if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked auth file'}
            $current=[Convert]::ToBase64String([IO.File]::ReadAllBytes($authFile))
            if($current -cne [string]$request.expected){[Console]::Out.Write('conflict');exit 0}
            [IO.File]::WriteAllBytes($pending,[Convert]::FromBase64String([string]$request.next))
            [IO.File]::Replace($pending,$authFile,[NullString]::Value)
            [Console]::Out.Write('committed')
        }finally{
            $lock.Dispose()
            [IO.File]::Delete($pending)
        }
        exit 0
    }
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class CodexAccountActivation {
    [ComImport, Guid("2E941141-7F97-4756-BA1D-9DECDE894A3D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActivation {
        [PreserveSig] int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string app,
            [MarshalAs(UnmanagedType.LPWStr)] string arguments, uint options, out uint pid);
    }
    public static uint Activate() {
        var manager=(IActivation)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")));
        try {
            uint pid;
            Marshal.ThrowExceptionForHR(manager.ActivateApplication("OpenAI.Codex_2p2nqsd0c76g0!App", "", 2, out pid));
            return pid;
        } finally { Marshal.FinalReleaseComObject(manager); }
    }
}
"@
    [CodexAccountActivation]::Activate()
}catch{
    exit 1
}
