// Read-only DWM watcher. The host owns changes and keeps its normal restore path.
using System;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Threading;

internal static class NativeBackdropWatch {
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int value, int size);
    private static readonly object gate = new object();
    private static bool running = true;
    private static long handle;
    private static int expected = -1;
    private static int commandVersion;

    private static void ReadCommands() {
        string line;
        while ((line = Console.ReadLine()) != null) {
            string[] parts = line.Split(' ');
            lock (gate) {
                if (line == "STOP") { running = false; return; }
                if (line == "OFF") { expected = -1; commandVersion++; continue; }
                long nextHandle;
                int nextExpected;
                if (parts.Length == 3 && parts[0] == "WATCH" &&
                    long.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out nextHandle) &&
                    int.TryParse(parts[2], out nextExpected) && (nextExpected == 1 || nextExpected == 3)) {
                    handle = nextHandle;
                    expected = nextExpected;
                    commandVersion++;
                }
            }
        }
        lock (gate) { running = false; }
    }

    private static void Main() {
        Thread input = new Thread(ReadCommands);
        input.IsBackground = true;
        input.Start();
        long lastHandle = 0;
        int lastUnexpected = -1;
        int lastCommand = -1;
        while (true) {
            long currentHandle;
            int wanted;
            int currentCommand;
            lock (gate) {
                if (!running) return;
                currentHandle = handle;
                wanted = expected;
                currentCommand = commandVersion;
            }
            if (currentCommand != lastCommand) { lastUnexpected = -1; lastCommand = currentCommand; }
            int actual;
            if (wanted < 0 || !IsWindow(new IntPtr(currentHandle)) ||
                DwmGetWindowAttribute(new IntPtr(currentHandle), 38, out actual, 4) != 0 || actual == wanted) {
                lastUnexpected = -1;
            } else if (lastHandle != currentHandle || lastUnexpected != actual) {
                Console.WriteLine("MISMATCH " + currentHandle + " " + actual + " " + wanted);
                Console.Out.Flush();
                lastUnexpected = actual;
            }
            lastHandle = currentHandle;
            Thread.Sleep(500);
        }
    }
}
