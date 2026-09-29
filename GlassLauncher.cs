using System;
using System.Diagnostics;
using System.IO;
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
                string output = process.StandardOutput.ReadToEnd();
                string error = process.StandardError.ReadToEnd();
                process.WaitForExit();
                if (process.ExitCode == 0) return 0;
                if (!quiet) MessageBox.Show(String.IsNullOrWhiteSpace(error) ? output : error,
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
