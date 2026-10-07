using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

// Changes only initial arguments in a validated new, still-suspended process.
// No executable code or installed files change.
public static class StartupArguments
{
    [StructLayout(LayoutKind.Sequential)]
    struct BasicInfo { public IntPtr exit,peb,affinity,priority,pid,parent; }
    [StructLayout(LayoutKind.Sequential)]
    struct PebPrefix { [MarshalAs(UnmanagedType.ByValArray,SizeConst=4)] public byte[] reserved; [MarshalAs(UnmanagedType.ByValArray,SizeConst=2)] public IntPtr[] reservedPointers; public IntPtr loader,parameters; }
    [StructLayout(LayoutKind.Sequential)]
    struct UnicodeString { public ushort length,maximum; public IntPtr buffer; }
    [StructLayout(LayoutKind.Sequential)]
    struct Parameters { [MarshalAs(UnmanagedType.ByValArray,SizeConst=16)] public byte[] reserved; [MarshalAs(UnmanagedType.ByValArray,SizeConst=10)] public IntPtr[] pointers; public UnicodeString image,command; }
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
    struct Startup { public uint cb; public IntPtr reserved,desktop,title; public uint x,y,xSize,ySize,xChars,yChars,fill,flags; public ushort show,reservedSize; public IntPtr reservedBytes,input,output,error; }
    [StructLayout(LayoutKind.Sequential)]
    public struct CreatedProcess { public IntPtr process,thread; public uint pid,tid; }
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
    static extern bool CreateProcess(string app,StringBuilder command,IntPtr ps,IntPtr ts,bool inherit,uint flags,IntPtr environment,string directory,ref Startup startup,out CreatedProcess result);
    [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr process,int type,out BasicInfo info,uint length,out uint returned);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool ReadProcessMemory(IntPtr process,IntPtr address,byte[] value,UIntPtr size,out UIntPtr read);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool WriteProcessMemory(IntPtr process,IntPtr address,byte[] value,UIntPtr size,out UIntPtr written);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsWow64Process(IntPtr process,out bool wow);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr process,uint flags,StringBuilder value,ref uint size);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFile(string path,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFinalPathNameByHandle(SafeFileHandle file,StringBuilder path,uint size,uint flags);
    [DllImport("kernel32.dll",SetLastError=true)] public static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll",SetLastError=true)] public static extern bool GetExitCodeProcess(IntPtr process,out uint code);
    [DllImport("kernel32.dll",SetLastError=true)] public static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
    static byte[] Read(IntPtr process,IntPtr address,int count) {
        var bytes=new byte[count];UIntPtr read;
        if(!ReadProcessMemory(process,address,bytes,(UIntPtr)count,out read)||read.ToUInt64()!=(ulong)count)throw new Win32Exception(Marshal.GetLastWin32Error());return bytes;
    }
    static T Structure<T>(byte[] bytes) {
        var pin=GCHandle.Alloc(bytes,GCHandleType.Pinned);try{return (T)Marshal.PtrToStructure(pin.AddrOfPinnedObject(),typeof(T));}finally{pin.Free();}
    }
    static byte[] Bytes<T>(T value) {
        int size=Marshal.SizeOf(typeof(T));var result=new byte[size];IntPtr buffer=Marshal.AllocHGlobal(size);
        try{for(int i=0;i<size;i++)Marshal.WriteByte(buffer,i,0);Marshal.StructureToPtr(value,buffer,false);Marshal.Copy(buffer,result,0,size);return result;}finally{Marshal.FreeHGlobal(buffer);}
    }
    static string Text(IntPtr process,UnicodeString value) {
        if(value.buffer==IntPtr.Zero||value.length==0||value.length%2!=0||value.length>value.maximum||value.maximum>65534)throw new Exception("Unsupported process parameter layout");
        return Encoding.Unicode.GetString(Read(process,value.buffer,value.length));
    }
    static void Write(IntPtr process,IntPtr address,byte[] bytes) {
        UIntPtr written;if(!WriteProcessMemory(process,address,bytes,(UIntPtr)bytes.Length,out written)||written.ToUInt64()!=(ulong)bytes.Length)throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    static string FinalPath(string path) {
        using(var file=CreateFile(path,0,7,IntPtr.Zero,3,0,IntPtr.Zero)){
            if(file.IsInvalid)throw new Win32Exception(Marshal.GetLastWin32Error());
            var buffer=new StringBuilder(32768);uint length=GetFinalPathNameByHandle(file,buffer,(uint)buffer.Capacity,0);
            if(length==0||length>=buffer.Capacity)throw new Win32Exception(Marshal.GetLastWin32Error());return buffer.ToString();
        }
    }
    static Parameters ValidatedParameters(IntPtr process,string expectedImage,out IntPtr address) {
        if(IntPtr.Size!=8)throw new Exception("Startup argument support is x64 only");
        bool wow;if(!IsWow64Process(process,out wow)||wow)throw new Exception("Unsupported target architecture");
        var image=new StringBuilder(32768);uint size=(uint)image.Capacity;
        if(!QueryFullProcessImageName(process,0,image,ref size)||!String.Equals(FinalPath(image.ToString()),FinalPath(expectedImage),StringComparison.OrdinalIgnoreCase))throw new Exception("Created process image does not match its expected test target");
        BasicInfo info;uint returned;
        if(NtQueryInformationProcess(process,0,out info,(uint)Marshal.SizeOf(typeof(BasicInfo)),out returned)!=0)throw new Exception("Cannot query process parameters");
        var peb=Structure<PebPrefix>(Read(process,info.peb,Marshal.SizeOf(typeof(PebPrefix))));
        var parameters=Structure<Parameters>(Read(process,peb.parameters,Marshal.SizeOf(typeof(Parameters))));
        string parameterImage=Text(process,parameters.image);
        if(parameterImage.StartsWith(@"\??\"))parameterImage=parameterImage.Substring(4);
        if(!String.Equals(FinalPath(parameterImage),FinalPath(expectedImage),StringComparison.OrdinalIgnoreCase))throw new Exception("Parameter image validation failed; no write performed");
        address=peb.parameters;return parameters;
    }
    public static string ReadCommandLine(IntPtr process,string expectedImage) {
        IntPtr address;return Text(process,ValidatedParameters(process,expectedImage,out address).command);
    }
    public static string Append(IntPtr process,string expectedImage,string addition) {
        return Append(process,expectedImage,addition,null);
    }
    public static string Append(IntPtr process,string expectedImage,string addition,string imageArgument) {
        IntPtr address;var parameters=ValidatedParameters(process,expectedImage,out address);
        string original=Text(process,parameters.command);
        // Keep the original allocation. Production uses a validated absolute
        // alias so Electron retains the official product's early profile name.
        if(!original.StartsWith("\""))throw new Exception("Unsupported command-line executable token; no write performed");
        int end=original.IndexOf('"',1);
        if(end<1||!String.Equals(FinalPath(original.Substring(1,end-1)),FinalPath(expectedImage),StringComparison.OrdinalIgnoreCase))throw new Exception("Command-line executable validation failed; no write performed");
        if(imageArgument!=null&&(!Path.IsPathRooted(imageArgument)||!String.Equals(FinalPath(imageArgument),FinalPath(expectedImage),StringComparison.OrdinalIgnoreCase)))throw new Exception("Argument image alias does not resolve to the official image; no write performed");
        string command="\""+(imageArgument??Path.GetFileName(expectedImage))+"\""+original.Substring(end+1)+" "+addition;
        byte[] text=Encoding.Unicode.GetBytes(command+"\0");
        if(text.Length>parameters.command.maximum)throw new Exception("Original command-line buffer has insufficient space; no write performed");
        IntPtr descriptor=IntPtr.Add(address,(int)Marshal.OffsetOf(typeof(Parameters),"command"));
        byte[] oldDescriptor=Read(process,descriptor,Marshal.SizeOf(typeof(UnicodeString)));
        byte[] oldText=Read(process,parameters.command.buffer,parameters.command.maximum);
        try {
            Write(process,parameters.command.buffer,text);
            var replacement=parameters.command;replacement.length=(ushort)(text.Length-2);
            Write(process,descriptor,Bytes(replacement));
            if(Text(process,Structure<UnicodeString>(Read(process,descriptor,Marshal.SizeOf(typeof(UnicodeString)))))!=command)throw new Exception("Argument verification failed");
            return command;
        }catch{
            Exception restoreError=null;
            try{Write(process,parameters.command.buffer,oldText);}catch(Exception error){restoreError=error;}
            try{Write(process,descriptor,oldDescriptor);}catch(Exception error){restoreError=error;}
            if(restoreError!=null)throw new Exception("Original argument restoration failed",restoreError);
            if(!String.Equals(Text(process,Structure<UnicodeString>(Read(process,descriptor,Marshal.SizeOf(typeof(UnicodeString))))),original,StringComparison.Ordinal))throw new Exception("Original argument restoration verification failed");
            throw;
        }
    }
    public static CreatedProcess StartTest(string target,string arguments,string addition,out string patchError) {
        var startup=new Startup{cb=(uint)Marshal.SizeOf(typeof(Startup))};CreatedProcess created;
        if(!CreateProcess(target,new StringBuilder("\""+target+"\" "+arguments),IntPtr.Zero,IntPtr.Zero,false,4,IntPtr.Zero,null,ref startup,out created))throw new Win32Exception(Marshal.GetLastWin32Error());
        patchError=null;
        try{if(!String.IsNullOrEmpty(addition))Append(created.process,target,addition);}catch(Exception error){patchError=error.Message;}
        finally{uint count=ResumeThread(created.thread);if(count==UInt32.MaxValue)patchError="ResumeThread failed: "+Marshal.GetLastWin32Error();else if(count>1)patchError="Initial thread still has an unexpected suspend count";}
        return created;
    }
}
