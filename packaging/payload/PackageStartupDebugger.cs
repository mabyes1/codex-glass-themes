using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

// Dummy debugger for package activation. It also supports a marked test mode.
// Windows supplies the new PID and its suspended initial thread. Only this
// package/user's fresh process can be resumed, and only the marked main patched.
internal static class PackageStartupDebugger {
    [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint id);
    [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenThread(uint access,bool inherit,uint id);
    [DllImport("kernel32.dll",SetLastError=true)] static extern uint GetProcessIdOfThread(IntPtr thread);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr process,out long creation,out long exit,out long kernel,out long user);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetThreadTimes(IntPtr thread,out long creation,out long exit,out long kernel,out long user);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern int GetPackageFullName(IntPtr process,ref uint length,StringBuilder name);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern int GetPackagePathByFullName(string package,ref uint length,StringBuilder path);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr process,uint flags,StringBuilder image,ref uint length);
    [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
    static uint Argument(string[] args,string key) {
        int index=Array.IndexOf(args,key);uint value;
        if(index<0||index+1>=args.Length||!UInt32.TryParse(args[index+1],out value)||value==0)throw new Exception("Missing Windows debugger argument "+key);
        return value;
    }
    static string PackageName(IntPtr process) {
        uint length=0;int error=GetPackageFullName(process,ref length,null);
        if(error!=122||length<2||length>1024)throw new Exception("Process package identity is unavailable");
        var name=new StringBuilder((int)length);error=GetPackageFullName(process,ref length,name);
        if(error!=0)throw new Win32Exception(error);return name.ToString();
    }
    static int Main(string[] args) {
        IntPtr process=IntPtr.Zero,thread=IntPtr.Zero;
        string log=null;bool canResume=false;
        var serializer=new JavaScriptSerializer();
        var result=new Dictionary<string,object>{{"pid",0},{"tid",0},{"patched",false},{"resumed",false},{"error",null}};
        try {
            uint pid=Argument(args,"-p"),tid=Argument(args,"-tid");result["pid"]=pid;result["tid"]=tid;
            process=OpenProcess(0x1038,false,pid);
            if(process==IntPtr.Zero)process=OpenProcess(0x1000,false,pid);
            if(process==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error());
            long creation,exit,kernel,user;
            if(!GetProcessTimes(process,out creation,out exit,out kernel,out user))throw new Win32Exception(Marshal.GetLastWin32Error());
            long now=DateTime.UtcNow.ToFileTimeUtc();
            long helperStarted=Process.GetCurrentProcess().StartTime.ToUniversalTime().ToFileTimeUtc();
            if(creation<helperStarted-TimeSpan.FromSeconds(30).Ticks||creation>helperStarted)throw new Exception("Process predates this activation callback");
            string package=PackageName(process);
            if(!Regex.IsMatch(package,@"^OpenAI\.Codex_[0-9.]+_x64__2p2nqsd0c76g0$"))throw new Exception("Process is not an official Codex package");
            var actualImage=new StringBuilder(32768);uint imageLength=(uint)actualImage.Capacity;
            if(!QueryFullProcessImageName(process,0,actualImage,ref imageLength))throw new Win32Exception(Marshal.GetLastWin32Error());
            uint packagePathLength=0;
            int packagePathError=GetPackagePathByFullName(package,ref packagePathLength,null);
            if(packagePathError!=122||packagePathLength<2||packagePathLength>32768)throw new Exception("Official package path is unavailable");
            var packagePath=new StringBuilder((int)packagePathLength);
            packagePathError=GetPackagePathByFullName(package,ref packagePathLength,packagePath);
            if(packagePathError!=0)throw new Win32Exception(packagePathError);
            string officialRoot=Path.Combine(packagePath.ToString(),"app");
            if(!String.Equals(actualImage.ToString(),Path.Combine(officialRoot,"ChatGPT.exe"),StringComparison.OrdinalIgnoreCase)&&!String.Equals(actualImage.ToString(),Path.Combine(officialRoot,"resources","codex-command-runner.exe"),StringComparison.OrdinalIgnoreCase))throw new Exception("Process image is not an official activation entry");
            string sid=WindowsIdentity.GetCurrent().User.Value;
            IntPtr token;
            if(!OpenProcessToken(process,8,out token))throw new Win32Exception(Marshal.GetLastWin32Error());
            try{using(var identity=new WindowsIdentity(token))if(identity.User.Value!=sid)throw new Exception("Process belongs to another user");}
            finally{StartupArguments.CloseHandle(token);}
            thread=OpenThread(0x802,false,tid);if(thread==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error());
            if(GetProcessIdOfThread(thread)!=pid)throw new Exception("Thread does not belong to the new process");
            long threadCreation;
            if(!GetThreadTimes(thread,out threadCreation,out exit,out kernel,out user)||threadCreation<creation||threadCreation-creation>TimeSpan.FromSeconds(2).Ticks)throw new Exception("Thread is not from initial activation");
            canResume=true;
            // Native recovery does not depend on a mutable configuration file.
            // Any failure below still resumes only the validated new entry.
            int configIndex=Array.IndexOf(args,"--config");
            if(configIndex<0||configIndex+1>=args.Length)throw new Exception("Missing activation configuration; native activation will resume");
            var config=serializer.Deserialize<Dictionary<string,object>>(File.ReadAllText(args[configIndex+1]));
            log=(string)config["log"];
            if(package!=(string)config["package"]||sid!=(string)config["sid"])throw new Exception("Activation configuration does not match this package/user");
            foreach(object value in (IEnumerable)config["excludedPids"])if(Convert.ToUInt32(value)==pid)throw new Exception("Existing process was excluded");
            if(creation<now-TimeSpan.FromSeconds(30).Ticks)throw new Exception("Late callback will resume natively without argument modification");
            long expires=Convert.ToInt64(config["expires"]);
            if(creation<Convert.ToInt64(config["notBefore"])||(expires>0&&now>expires))throw new Exception("Argument modification window has expired; native activation will resume");
            string command=StartupArguments.ReadCommandLine(process,(string)config["image"]);
            if(Regex.IsMatch(command,@"(^|\s)--type="))throw new Exception("Child process will resume without argument modification");
            string mode=config.ContainsKey("mode")?(string)config["mode"]:"isolated";
            if(mode=="isolated"){
                string profile=(string)config["requiredProfile"];
                if(String.IsNullOrEmpty(profile)||command.IndexOf(profile,StringComparison.OrdinalIgnoreCase)<0)throw new Exception("Activation has no isolated test profile; native activation will resume");
            }else if(mode!="user-main")throw new Exception("Unknown activation mode; native activation will resume");
            if(command.IndexOf("--remote-debugging-port",StringComparison.OrdinalIgnoreCase)<0){
                // A bare filename changes Electron's early profile name to
                // ChatGPT. Keep an absolute alias to the same official image.
                string imageArgument=(string)config["imageArgument"];
                if(String.IsNullOrEmpty(imageArgument))throw new Exception("Absolute image argument is missing; native activation will resume");
                StartupArguments.Append(process,(string)config["image"],"--remote-debugging-port=0",imageArgument);
                result["patched"]=true;
            }
        }catch(Exception error){result["error"]=error.Message;}
        finally {
            if(canResume){
                uint count=StartupArguments.ResumeThread(thread);result["resumePreviousCount"]=count;
                result["resumed"]=count!=UInt32.MaxValue&&count<=1;
                if(!(bool)result["resumed"])result["error"]="Initial thread resume failed or remained suspended";
            }
            if(thread!=IntPtr.Zero)StartupArguments.CloseHandle(thread);
            if(process!=IntPtr.Zero)StartupArguments.CloseHandle(process);
            if(log!=null){try{if(File.Exists(log)&&new FileInfo(log).Length>1048576)File.WriteAllText(log,"");File.AppendAllText(log,serializer.Serialize(result)+Environment.NewLine);}catch{}}
        }
        return (bool)result["resumed"]?0:1;
    }
}
