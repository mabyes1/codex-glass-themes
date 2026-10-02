// Event-driven material repair. Full window/renderer setup stays in the host.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

internal static class NativeBackdropWatch {
    private delegate void WinEventProc(IntPtr hook, uint kind, IntPtr window, int obj, int child, uint thread, uint time);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] private static extern IntPtr SetWinEventHook(uint first, uint last, IntPtr module, WinEventProc callback, uint process, uint thread, uint flags);
    [DllImport("user32.dll")] private static extern bool UnhookWinEvent(IntPtr hook);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int value, int size);
    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);
    private static readonly List<IntPtr> hooks = new List<IntPtr>();
    private static readonly WinEventProc callback = OnWindowEvent;
    private static Control dispatcher;
    private static long handle;
    private static int expected = -1, lastUnexpected = -1;
    private static long checks, notifications;

    private static void OnWindowEvent(IntPtr hook, uint kind, IntPtr window, int obj, int child, uint thread, uint time) {
        // Ignore accessibility events from individual controls and other windows.
        if (window.ToInt64() == handle && obj == 0 && child == 0) Check();
    }

    private static void Check() {
        if (expected < 0 || !IsWindow(new IntPtr(handle))) return;
        int actual;
        checks++;
        if (DwmGetWindowAttribute(new IntPtr(handle), 38, out actual, 4) != 0) return;
        if (actual == expected) { lastUnexpected = -1; return; }
        if (lastUnexpected == actual) return;
        lastUnexpected = actual;
        int wanted = expected;
        int result = DwmSetWindowAttribute(new IntPtr(handle), 38, ref wanted, 4);
        int restored;
        if (result == 0 && DwmGetWindowAttribute(new IntPtr(handle), 38, out restored, 4) == 0 && restored == expected) {
            lastUnexpected = -1;
            notifications++;
            Console.WriteLine("REPAIRED " + handle + " " + actual + " " + expected);
        } else {
            Console.WriteLine("REPAIR_FAILED " + handle + " " + actual + " " + expected);
        }
        Console.Out.Flush();
    }

    private static void Unhook() {
        foreach (IntPtr hook in hooks) UnhookWinEvent(hook);
        hooks.Clear();
    }

    private static void Hook(long nextHandle) {
        Unhook();
        handle = nextHandle;
        uint process;
        GetWindowThreadProcessId(new IntPtr(handle), out process);
        if (process == 0) return;
        // Foreground, minimize/restore, show/hide, window state and geometry.
        foreach (uint[] range in new uint[][] {new uint[] {3,3},new uint[] {16,17},new uint[] {0x8002,0x8003},new uint[] {0x800A,0x800C}}) {
            IntPtr hook = SetWinEventHook(range[0], range[1], IntPtr.Zero, callback, process, 0, 0);
            if (hook != IntPtr.Zero) hooks.Add(hook);
            else Console.Error.WriteLine("Could not subscribe to window events: " + range[0]);
        }
    }

    private static void Command(string line) {
        if (line == "STOP") { Application.ExitThread(); return; }
        if (line == "OFF") { expected = -1; lastUnexpected = -1; return; }
        if (line == "CHECK") { Check(); return; }
        if (line == "STATS") {
            Console.WriteLine("STATS " + checks + " " + notifications);
            Console.Out.Flush();
            return;
        }
        string[] parts = line.Split(' ');
        long nextHandle;
        int nextExpected;
        if (parts.Length == 3 && parts[0] == "WATCH" &&
            long.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out nextHandle) &&
            int.TryParse(parts[2], out nextExpected) && (nextExpected == 1 || nextExpected == 3)) {
            if (handle != nextHandle) Hook(nextHandle);
            expected = nextExpected;
            lastUnexpected = -1;
            Check();
        }
    }

    [STAThread] private static void Main() {
        dispatcher = new Control();
        IntPtr dispatcherHandle = dispatcher.Handle;
        GCHandle keepCallback = GCHandle.Alloc(callback);
        Thread input = new Thread(() => {
            string line;
            while ((line = Console.ReadLine()) != null) {
                string command = line;
                try { dispatcher.BeginInvoke((Action)(() => Command(command))); }
                catch (InvalidOperationException) { return; }
                if (line == "STOP") return;
            }
            try { dispatcher.BeginInvoke((Action)(() => Command("STOP"))); }
            catch (InvalidOperationException) { }
        });
        input.IsBackground = true;
        input.Start();
        try { Application.Run(); }
        finally { expected = -1; Unhook(); keepCallback.Free(); dispatcher.Dispose(); }
    }
}
