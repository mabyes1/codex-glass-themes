using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.ComponentModel;
using System.Collections.Generic;
using System.Text;

// Current-user registration lookup without importing the PowerShell Appx module.
public static class CodexPackageCatalog {
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]
    static extern int GetPackagesByPackageFamily(string family,ref uint count,IntPtr names,ref uint length,IntPtr buffer);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]
    static extern int GetPackagePathByFullName(string name,ref uint length,StringBuilder path);
    public sealed class Package {
        public string PackageFullName {get;set;}
        public string InstallLocation {get;set;}
    }
    public static Package[] Find() {
        for(int attempt=0;attempt<3;attempt++) {
            uint count=0,length=0;
            int error=GetPackagesByPackageFamily("OpenAI.Codex_2p2nqsd0c76g0",ref count,IntPtr.Zero,ref length,IntPtr.Zero);
            if(error==0&&count==0)return new Package[0];
            if(error!=122)throw new Win32Exception(error);
            if(count>256||length>1048576)throw new InvalidOperationException("Unexpected package inventory size");
            IntPtr names=Marshal.AllocHGlobal(checked((int)count*IntPtr.Size));
            IntPtr buffer=Marshal.AllocHGlobal(checked((int)length*2));
            try {
                error=GetPackagesByPackageFamily("OpenAI.Codex_2p2nqsd0c76g0",ref count,names,ref length,buffer);
                if(error==122)continue; // Registration changed between the two calls.
                if(error!=0)throw new Win32Exception(error);
                var result=new List<Package>();
                for(int i=0;i<count;i++) {
                    string name=Marshal.PtrToStringUni(Marshal.ReadIntPtr(names,i*IntPtr.Size));
                    uint size=0;error=GetPackagePathByFullName(name,ref size,null);
                    if(error==15700||error==1168)continue; // Removed during enumeration.
                    if(error!=122)throw new Win32Exception(error);
                    if(size>32768)throw new InvalidOperationException("Unexpected package path length");
                    var path=new StringBuilder((int)size);
                    error=GetPackagePathByFullName(name,ref size,path);
                    if(error==15700||error==1168)continue;
                    if(error!=0)throw new Win32Exception(error);
                    result.Add(new Package {PackageFullName=name,InstallLocation=path.ToString()});
                }
                return result.ToArray();
            }finally{Marshal.FreeHGlobal(buffer);Marshal.FreeHGlobal(names);}
        }
        throw new InvalidOperationException("Package registration kept changing; retry on next poll");
    }
}

// Short-lived experiment scope. Never suspends or terminates a package.
public sealed class PackageDebugSession : IDisposable
{
    [ComImport,Guid("F27C3930-8029-4AD1-94E3-3DBA417810C1"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ISettings {
        [PreserveSig] int EnableDebugging([MarshalAs(UnmanagedType.LPWStr)] string package,[MarshalAs(UnmanagedType.LPWStr)] string debugger,IntPtr environment);
        [PreserveSig] int DisableDebugging([MarshalAs(UnmanagedType.LPWStr)] string package);
    }
    ISettings settings;
    string package;
    Timer deadline;
    int disposed;
    public int EnableResult {get;private set;}
    public int? DisableResult {get;private set;}
    public string CleanupError {get;private set;}
    public PackageDebugSession(string packageName,string debugger,IntPtr environment) : this(packageName,debugger,environment,35000) {}
    public PackageDebugSession(string packageName,string debugger,IntPtr environment,int deadlineMilliseconds) {
        if(deadlineMilliseconds<0)throw new ArgumentOutOfRangeException("deadlineMilliseconds");
        package=packageName;
        settings=(ISettings)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("B1AEC16F-2383-4852-B0E9-8F0B1DC66B4D")));
        EnableResult=settings.EnableDebugging(package,String.IsNullOrEmpty(debugger)?null:debugger,environment);
        if(EnableResult<0){Marshal.FinalReleaseComObject(settings);settings=null;Marshal.ThrowExceptionForHR(EnableResult);}
        if(deadlineMilliseconds>0)deadline=new Timer(_=>Dispose(),null,deadlineMilliseconds,Timeout.Infinite);
    }
    public static void Disable(string packageName) {
        var cleanup=(ISettings)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("B1AEC16F-2383-4852-B0E9-8F0B1DC66B4D")));
        try{Marshal.ThrowExceptionForHR(cleanup.DisableDebugging(packageName));}
        finally{Marshal.FinalReleaseComObject(cleanup);}
    }
    public void ReleaseWithoutDisabling() {
        // Another debugger replaced our registration; release only our RCW.
        if(Interlocked.Exchange(ref disposed,1)!=0)return;
        if(deadline!=null)deadline.Dispose();
        if(settings!=null){Marshal.FinalReleaseComObject(settings);settings=null;}
    }
    public void Dispose() {
        if(Interlocked.Exchange(ref disposed,1)!=0)return;
        if(deadline!=null)deadline.Dispose();
        try{DisableResult=settings.DisableDebugging(package);if(DisableResult<0)CleanupError="DisableDebugging HRESULT "+DisableResult;}
        catch(Exception error){CleanupError=error.Message;}
        finally{if(settings!=null){Marshal.FinalReleaseComObject(settings);settings=null;}}
    }
}
