using System;
using System.Diagnostics;
using System.IO;

internal static class StartThemeWatcher
{
    private static int Main()
    {
        string root = Directory.GetParent(AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar)).FullName;
        string script = Path.Combine(root, "Start-Theme-Auto.ps1");
        string log = Path.Combine(root, ".runtime-auto", "launcher-error.log");

        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(log));
            var start = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.SystemDirectory, @"WindowsPowerShell\v1.0\powershell.exe"),
                Arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + script + "\"",
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            using (var watcher = new Process { StartInfo = start })
            {
                watcher.Start();
                watcher.WaitForExit();
                int exitCode = watcher.ExitCode;
                if (exitCode != 0)
                    LogError(log, "PowerShell watcher exited with code " + exitCode);
                return exitCode;
            }
        }
        catch (Exception error)
        {
            LogError(log, error.Message);
            return 1;
        }
    }

    private static void LogError(string path, string message)
    {
        try
        {
            File.AppendAllText(path, DateTimeOffset.Now.ToString("o") + " " + message + Environment.NewLine);
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
}
