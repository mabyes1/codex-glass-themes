using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

[assembly: AssemblyTitle("ChatGPT Glass Themes Setup")]
[assembly: AssemblyDescription("Current-user Codex theme installer")]
[assembly: AssemblyVersion("1.2.0.0")]
[assembly: AssemblyFileVersion("1.2.0.0")]
internal static class Setup {
    internal static readonly string DefaultRoot=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),"CodexGlass");
    static string Option(string[] args,string key) {
        int index=Array.IndexOf(args,key);
        if(index<0)return null;
        if(index+1>=args.Length||args[index+1].StartsWith("--"))throw new ArgumentException("Missing value for "+key);
        return args[index+1];
    }
    internal static string Quote(string value) {
        var result=new StringBuilder("\"");int slashes=0;
        foreach(char c in value){if(c=='\\'){slashes++;continue;}if(c=='"'){result.Append('\\',slashes*2+1);result.Append(c);}else{result.Append('\\',slashes);result.Append(c);}slashes=0;}
        result.Append('\\',slashes*2);result.Append('"');return result.ToString();
    }
    internal static void Extract(string target) {
        target=Path.GetFullPath(target);
        if(Directory.Exists(target)) {
            if((File.GetAttributes(target)&FileAttributes.ReparsePoint)!=0||Directory.GetFileSystemEntries(target).Length!=0)throw new IOException("Extraction requires a new or empty ordinary directory.");
        }else Directory.CreateDirectory(target);
        string prefix=target.TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
        using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
        using(var zip=new ZipArchive(stream,ZipArchiveMode.Read)) {
            foreach(var entry in zip.Entries) {
                if(entry.FullName.IndexOf('\\')>=0||entry.FullName.IndexOf(':')>=0)throw new IOException("Invalid payload path");
                string output=Path.GetFullPath(Path.Combine(target,entry.FullName.Replace('/',Path.DirectorySeparatorChar)));
                if(!output.StartsWith(prefix,StringComparison.OrdinalIgnoreCase))throw new IOException("Payload path escaped extraction directory");
                if(entry.FullName.EndsWith("/")){Directory.CreateDirectory(output);continue;}
                Directory.CreateDirectory(Path.GetDirectoryName(output));
                using(var input=entry.Open())using(var file=new FileStream(output,FileMode.CreateNew,FileAccess.Write))input.CopyTo(file);
            }
        }
    }
    internal static int RunBackend(string action,string root,Action<string> output) {
        string staging=Path.Combine(Path.GetTempPath(),"CodexGlassSetup-"+Guid.NewGuid().ToString("N"));
        try{
            Extract(staging);
            string powershell=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows),"System32","WindowsPowerShell","v1.0","powershell.exe");
            var info=new ProcessStartInfo(powershell,"-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "+Quote(Path.Combine(staging,"Setup-Theme.ps1"))+" -Action "+action+" -InstallRoot "+Quote(root));
            info.UseShellExecute=false;info.CreateNoWindow=true;info.RedirectStandardOutput=true;info.RedirectStandardError=true;info.StandardOutputEncoding=Encoding.UTF8;info.StandardErrorEncoding=Encoding.UTF8;info.WorkingDirectory=staging;
            using(var process=Process.Start(info)) {
                process.OutputDataReceived+=(sender,e)=>{if(e.Data!=null)output(e.Data);};
                process.ErrorDataReceived+=(sender,e)=>{if(e.Data!=null)output(e.Data);};
                process.BeginOutputReadLine();process.BeginErrorReadLine();process.WaitForExit();return process.ExitCode;
            }
        }finally{
            // This unique directory contains only the embedded ordinary files.
            // Backend state and aliases are created in the installation root.
            if(Directory.Exists(staging))Directory.Delete(staging,true);
        }
    }
    [STAThread] static int Main(string[] args) {
        // A WinExe may have redirected streams without an attached console.
        // Set TextWriters directly; OutputEncoding calls a console API which
        // fails with ERROR_INVALID_HANDLE in that ordinary launch mode.
        var stdout=new StreamWriter(Console.OpenStandardOutput(),new UTF8Encoding(false)){AutoFlush=true};
        var stderr=new StreamWriter(Console.OpenStandardError(),new UTF8Encoding(false)){AutoFlush=true};
        Console.SetOut(stdout);Console.SetError(stderr);
        try{
            string extract=Option(args,"--extract-only");
            if(extract!=null){Extract(extract);Console.WriteLine("Payload extracted.");return 0;}
            string root=Option(args,"--install-root")??DefaultRoot;
            string action=Array.IndexOf(args,"--check-only")>=0?"Check":Array.IndexOf(args,"--stage-only")>=0?"Stage":Array.IndexOf(args,"--uninstall")>=0?"Uninstall":"Install";
            if(Array.IndexOf(args,"--silent")>=0||action=="Check"||action=="Stage")return RunBackend(action,root,Console.WriteLine);
            Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
            using(var form=new SetupForm(root,action))Application.Run(form);
            return 0;
        }catch(Exception error){Console.Error.WriteLine(error.Message);if(Array.IndexOf(args,"--silent")<0&&Array.IndexOf(args,"--extract-only")<0&&Array.IndexOf(args,"--check-only")<0&&Array.IndexOf(args,"--stage-only")<0)MessageBox.Show(error.Message,"ChatGPT Glass Themes",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1;}
    }
}
internal sealed class SetupForm:Form {
    readonly string root,action;readonly Button install;readonly TextBox log;readonly Label status;readonly ProgressBar progress;
    bool busy,finished;
    internal SetupForm(string installRoot,string selectedAction) {
        root=installRoot;action=selectedAction;Text="ChatGPT Glass Themes";ClientSize=new Size(620,440);FormBorderStyle=FormBorderStyle.FixedDialog;MaximizeBox=false;StartPosition=FormStartPosition.CenterScreen;BackColor=Color.FromArgb(246,248,252);Font=new Font("Microsoft JhengHei UI",10);
        var title=new Label{Text=action=="Uninstall"?"解除安裝自動主題":"讓每次啟動，都有喜歡的佈景。",Location=new Point(28,25),Size=new Size(570,42),Font=new Font(Font.FontFamily,19,FontStyle.Bold),ForeColor=Color.FromArgb(34,43,68)};
        var detail=new Label{Text="ChatGPT.exe · Windows Codex 桌面版\r\n安裝後照常開啟原圖示，配色、圖片與玻璃效果自動套用。",Location=new Point(30,80),Size=new Size(560,54)};
        var path=new Label{Text="安裝位置："+root,Location=new Point(30,145),Size=new Size(560,36),AutoEllipsis=true,ForeColor=Color.FromArgb(80,90,110)};
        status=new Label{Text="適用 Windows 11 x64（22621 以上）；請先安裝官方 Codex。",Location=new Point(30,190),Size=new Size(560,40)};
        progress=new ProgressBar{Location=new Point(30,239),Size=new Size(560,8),Visible=false};
        log=new TextBox{Location=new Point(30,261),Size=new Size(560,99),Multiline=true,ReadOnly=true,ScrollBars=ScrollBars.Vertical,BorderStyle=BorderStyle.None,BackColor=BackColor,Font=new Font("Microsoft JhengHei UI",9)};
        install=new Button{Text=action=="Uninstall"?"解除安裝":"安裝並啟用",Location=new Point(411,381),Size=new Size(179,38),FlatStyle=FlatStyle.Flat,BackColor=Color.FromArgb(73,91,170),ForeColor=Color.White};
        var close=new Button{Text="關閉",Location=new Point(297,381),Size=new Size(99,38)};
        close.Click+=(s,e)=>Close();install.Click+=Install;FormClosing+=(s,e)=>{if(busy)e.Cancel=true;};
        Controls.AddRange(new Control[]{title,detail,path,status,progress,log,install,close});
    }
    void Append(string text) {
        if(IsDisposed)return;if(InvokeRequired){BeginInvoke(new Action<string>(Append),text);return;}
        if(text.StartsWith("{"))try{
            var value=new System.Web.Script.Serialization.JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string,object>>(text);
            if(value.ContainsKey("ok")){
                if((bool)value["ok"])return;
                text=Convert.ToString(value["error"]);
                object rollback;if(value.TryGetValue("rollbackError",out rollback)&&rollback!=null)text+="\r\n清理狀態："+Convert.ToString(rollback);
            }
        }catch{}
        log.AppendText(text+Environment.NewLine);
    }
    async void Install(object sender,EventArgs e) {
        if(finished){if(action!="Uninstall")Process.Start(new ProcessStartInfo("explorer.exe","shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App"){UseShellExecute=true});Close();return;}
        busy=true;install.Enabled=false;progress.Visible=true;progress.Style=ProgressBarStyle.Marquee;status.Text="正在處理，請稍候…";
        try {
            int code=await Task.Run(()=>Setup.RunBackend(action,root,Append));
            if(code!=0){status.Text="尚未完成；請查看下方原因後再試一次。";return;}
            finished=true;status.Text=action=="Uninstall"?"已解除安裝；原本的主題偏好與圖片保留。":"已啟用！若 Codex 正在執行，請完整退出一次再開啟。";install.Text=action=="Uninstall"?"完成":"完成，開啟 Codex";
        }catch(Exception error){Append(error.Message);status.Text="尚未完成；請查看下方原因。";}
        finally{busy=false;install.Enabled=true;progress.Style=ProgressBarStyle.Blocks;}
    }
}
