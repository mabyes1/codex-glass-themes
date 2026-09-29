using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows.Forms;

internal static class GlassLauncher
{
    [STAThread]
    private static int Main(string[] args)
    {
        bool checkOnly = args.Length > 0 && args[0] == "--check";
        bool quiet = checkOnly || (args.Length > 0 && args[0] == "--quiet");
        string script = @"__SCRIPT_PATH__";
        if (checkOnly) script = Path.Combine(Path.GetDirectoryName(script), "Ensure-CodexCdp.ps1");
        if (!File.Exists(script))
        {
            if (!quiet) MessageBox.Show("找不到佈景套件，請重新建立桌面啟動檔。", "Codex 玻璃佈景", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 2;
        }

        try
        {
            var start = new ProcessStartInfo("powershell.exe", "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + script + "\"" + (checkOnly ? " -CheckOnly" : ""));
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.WindowStyle = ProcessWindowStyle.Hidden;
            start.RedirectStandardOutput = true;
            start.RedirectStandardError = true;
            using (var process = Process.Start(start))
            {
                // The background helper can inherit pipe handles. Do not wait
                // for EOF from descendants after PowerShell has already exited.
                var capture = new StringBuilder();
                object gate = new object();
                DataReceivedEventHandler collect = delegate(object sender, DataReceivedEventArgs message)
                {
                    if (message.Data != null) lock (gate) capture.AppendLine(message.Data);
                };
                process.OutputDataReceived += collect;
                process.ErrorDataReceived += collect;
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                if (!process.WaitForExit(60000)) throw new TimeoutException("佈景啟動逾時，請查看套件的 .runtime 資料夾。");
                string output;
                lock (gate) output = capture.ToString();
                File.WriteAllText(Path.Combine(Path.GetDirectoryName(script), ".runtime", "launcher.log"),
                    DateTime.Now.ToString("s") + " ExitCode=" + process.ExitCode + Environment.NewLine + output, Encoding.UTF8);
                if (process.ExitCode == 0) return 0;
                if (!quiet) MessageBox.Show(String.IsNullOrWhiteSpace(output) ? "佈景啟動失敗，請查看 .runtime/host-error.log。" : output,
                    "Codex 玻璃佈景啟動失敗", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return process.ExitCode;
            }
        }
        catch (Exception error)
        {
            if (!quiet) MessageBox.Show(error.Message, "Codex 玻璃佈景啟動失敗", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
