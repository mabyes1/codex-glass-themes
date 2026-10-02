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
                if (process.ExitCode == 20)
                {
                    if (!quiet) MessageBox.Show(
                        "Codex 已開啟，但這次啟動沒有啟用 CDP，暫時無法注入佈景。\n\n" +
                        "請先保存或送出輸入內容，再完整結束 Codex（不只是關閉視窗），然後雙擊這個 EXE。\n\n" +
                        "之後使用這個 EXE 開啟 Codex，就會自動帶上 CDP 並套用佈景。預設使用 9222；若被占用會自動換埠。\n\n" +
                        "若 Codex 已有 CDP，這個 EXE 會直接連線，不需重開。",
                        "Codex 需要啟用 CDP", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return 20;
                }
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
