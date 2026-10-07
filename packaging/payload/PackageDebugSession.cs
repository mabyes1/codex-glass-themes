using System;
using System.Runtime.InteropServices;
using System.Threading;

// Owns a package debug session and releases it on disposal or an optional deadline.
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
    public void Dispose() {
        if(Interlocked.Exchange(ref disposed,1)!=0)return;
        if(deadline!=null)deadline.Dispose();
        try{DisableResult=settings.DisableDebugging(package);if(DisableResult<0)CleanupError="DisableDebugging HRESULT "+DisableResult;}
        catch(Exception error){CleanupError=error.Message;}
        finally{if(settings!=null){Marshal.FinalReleaseComObject(settings);settings=null;}}
    }
}
