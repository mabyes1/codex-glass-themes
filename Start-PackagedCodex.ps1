param(
    [Parameter(Mandatory=$true)][string]$AppUserModelId,
    [Parameter(Mandatory=$true)][int]$Port,
    [switch]$ProbeOnly
)
$ErrorActionPreference='Stop'

# Activate the Store package by AppUserModelId. Its installed executable path is
# protected and is not a reliable entry point for an unpackaged launcher.
if(-not ('CodexPackagedActivation' -as [type])){
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IApplicationActivationManager
{
    [PreserveSig]
    int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
        [MarshalAs(UnmanagedType.LPWStr)] string arguments, uint options, out uint processId);
}

public static class CodexPackagedActivation
{
    public static void Probe()
    {
        var clsid = new Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C");
        var manager = Activator.CreateInstance(Type.GetTypeFromCLSID(clsid, true));
        Marshal.ReleaseComObject(manager);
    }

    public static uint Launch(string appUserModelId, string arguments)
    {
        var clsid = new Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C");
        var manager = (IApplicationActivationManager)Activator.CreateInstance(Type.GetTypeFromCLSID(clsid, true));
        uint processId;
        int result = manager.ActivateApplication(appUserModelId, arguments, 0, out processId);
        Marshal.ThrowExceptionForHR(result);
        return processId;
    }
}
'@
}

if($ProbeOnly){[CodexPackagedActivation]::Probe(); exit 0}
$arguments="--remote-debugging-address=127.0.0.1 --remote-debugging-port=$Port"
[CodexPackagedActivation]::Launch($AppUserModelId,$arguments)
