// Event-driven, read-only DWM check. Only the host changes window materials.
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
    private static readonly List<IntPtr> hooks = new List<IntPtr>();
    private static readonly WinEventProc callback = OnWindowEvent;
    private static Control dispatcher;
    private static System.Windows.Forms.Timer pending;
    private static long handle;
    private static int expected = -1, lastUnexpected = -1;
    private static long checks, notifications;

    private static void Schedule() {
        if (expected >= 0 && !pending.Enabled) pending.Start();
    }

    private static void OnWindowEvent(IntPtr hook, uint kind, IntPtr window, int obj, int child, uint thread, uint time) {
        // Ignore accessibility events from individual controls and other windows.
        if (window.ToInt64() == handle && obj == 0 && child == 0) Schedule();
    }

    private static void Check() {
        if (expected < 0 || !IsWindow(new IntPtr(handle))) return;
        int actual;
        checks++;
        if (DwmGetWindowAttribute(new IntPtr(handle), 38, out actual, 4) != 0) return;
        if (actual == expected) { lastUnexpected = -1; return; }
        if (lastUnexpected == actual) return;
        lastUnexpected = actual;
        notifications++;
        Console.WriteLine("MISMATCH " + handle + " " + actual + " " + expected);
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
        foreach (uint[] range in new uint[][] {new uint[] {3,3},new uint[] {16,17},new uint[] {0x8002,0x8003},new uint[] {0x800A,0x800B}}) {
            IntPtr hook = SetWinEventHook(range[0], range[1], IntPtr.Zero, callback, process, 0, 0);
            if (hook != IntPtr.Zero) hooks.Add(hook);
            else Console.Error.WriteLine("Could not subscribe to window events: " + range[0]);
        }
    }

    private static void Command(string line) {
        if (line == "STOP") { Application.ExitThread(); return; }
        if (line == "OFF") { expected = -1; lastUnexpected = -1; pending.Stop(); return; }
        if (line == "CHECK") { Schedule(); return; }
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
        pending = new System.Windows.Forms.Timer();
        pending.Interval = 80;
        pending.Tick += (sender, args) => { pending.Stop(); Check(); };
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
        finally { expected = -1; pending.Dispose(); Unhook(); keepCallback.Free(); dispatcher.Dispose(); }
    }
}
