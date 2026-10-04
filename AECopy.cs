// Author: Ilhan Turan - https://ilhanturan.fr
// AECopy v1.0.0 - Ctrl+C / Ctrl+V between several After Effects (2020 to 2026).
//
// Ctrl+C dans un After Effects : le raccourci passe normalement, et le script AECopy de cet After Effects
// ecrit la selection dans mailbox\clipboard.json. Ctrl+V dans un AUTRE After Effects : le raccourci est
// intercepte et ce After Effects reconstruit la copie. Meme After Effects, ou copie faite ailleurs : collage normal.
//
// Demarre avec Windows (reglable) et reste en veille ; s'allume quand un AfterFX apparait.
// Le script AECopy.jsx est installe dans Scripts\Startup de chaque version d'After Effects, et injecte
// (AfterFX.exe -r) dans ceux deja ouverts : bouton Inject, ou automatiquement quand on passe sur leur fenetre.
//
// Compilation (voir build.ps1) : csc /target:winexe /win32icon:AECopy.ico ... AECopy.cs

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

static class Program
{
    public const string Version = "1.0.0";
    public const string Website = "https://ilhanturan.fr";
    public const string MutexName = "AECopy_single_instance";
    public const string ShowEventName = "AECopy_show_window";
    public const string QuitEventName = "AECopy_quit";
    public const string ReloadEventName = "AECopy_reload";
    public static readonly string Home = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
    // Hors d'AppData : lance depuis une appli empaquetee (MSIX), AppData serait redirige.
    public static readonly string Root = Path.Combine(Home, "mailbox");

    public static void Log(string msg)
    {
        try
        {
            Directory.CreateDirectory(Root);
            string path = Path.Combine(Root, "app.log");
            // Au-dela de 1 Mo : le journal devient app.old.log (le precedent est remplace).
            var fi = new FileInfo(path);
            if (fi.Exists && fi.Length > 1000000)
            {
                string old = Path.Combine(Root, "app.old.log");
                if (File.Exists(old)) File.Delete(old);
                File.Move(path, old);
            }
            File.AppendAllText(path, DateTime.Now.ToString("dd/MM HH:mm:ss") + " " + msg + Environment.NewLine);
        }
        catch { }
    }

    [STAThread]
    static int Main(string[] args)
    {
        if (args.Length == 2 && args[0] == "--whoami") return WhoAmI.Run(args[1]);
        if (args.Length == 2 && args[0] == "--make-icon") { Logo.SaveIco(args[1]); return 0; }
        if (args.Length == 1 && (args[0] == "--quit" || args[0] == "--reload"))
        {
            string name = args[0] == "--quit" ? QuitEventName : ReloadEventName;
            try { using (var ev = EventWaitHandle.OpenExisting(name)) ev.Set(); return 0; } catch { return 1; }
        }
        bool tray = args.Length > 0 && args[0] == "--tray";

        bool created;
        using (var mutex = new Mutex(true, MutexName, out created))
        {
            if (!created)
            {
                // Deja lance : on demande a la copie en cours d'afficher sa fenetre.
                if (!tray) { try { using (var ev = EventWaitHandle.OpenExisting(ShowEventName)) ev.Set(); } catch { } }
                return 0;
            }
            Directory.CreateDirectory(Root);
            Log("AECopy " + Version + " started (pid " + Process.GetCurrentProcess().Id + ")");
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            var app = new AppContext(!tray);
            Application.Run(app);
            app.Shutdown();
        }
        return 0;
    }
}

// ------------------------------------------------------------------ logo

static class Logo
{
    static readonly Color TileTop = Color.FromArgb(0x2E, 0x14, 0x6E);
    static readonly Color TileBottom = Color.FromArgb(0x12, 0x06, 0x2E);
    public static readonly Color Accent = Color.FromArgb(0x9C, 0x8C, 0xFF);
    static readonly Color Front = Color.FromArgb(0xC4, 0xB8, 0xFF);

    static GraphicsPath Rounded(RectangleF r, float rad)
    {
        var p = new GraphicsPath();
        float d = rad * 2;
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }

    // Tuile violette, deux cartes decalees (copie) et « Ae » sur la carte de devant.
    public static Bitmap Draw(int size)
    {
        var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        float k = size / 256f;
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
            g.Clear(Color.Transparent);
            var tile = new RectangleF(0, 0, size - 1, size - 1);
            using (var path = Rounded(tile, 56 * k))
            using (var br = new LinearGradientBrush(tile, TileTop, TileBottom, 90f))
                g.FillPath(br, path);
            using (var back = Rounded(new RectangleF(46 * k, 40 * k, 120 * k, 120 * k), 22 * k))
            using (var pen = new Pen(Accent, Math.Max(1.5f, 13 * k)))
                g.DrawPath(pen, back);
            var fr = new RectangleF(90 * k, 96 * k, 120 * k, 120 * k);
            using (var front = Rounded(fr, 22 * k))
            using (var fb = new SolidBrush(Front))
                g.FillPath(fb, front);
            if (size >= 24)
            {
                using (var f = new Font("Segoe UI", 50 * k, FontStyle.Bold, GraphicsUnit.Pixel))
                using (var tb = new SolidBrush(TileBottom))
                using (var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                    g.DrawString("Ae", f, tb, new RectangleF(fr.X, fr.Y + 2 * k, fr.Width, fr.Height), sf);
            }
        }
        return bmp;
    }

    public static Icon MakeIcon(int size)
    {
        using (var b = Draw(size)) return Icon.FromHandle(b.GetHicon());
    }

    // Fichier .ico multi-tailles (entrees PNG), pour l'icone de l'exe.
    public static void SaveIco(string path)
    {
        int[] sizes = { 16, 24, 32, 48, 64, 128, 256 };
        var pngs = new List<byte[]>();
        foreach (int s in sizes)
            using (var b = Draw(s))
            using (var ms = new MemoryStream()) { b.Save(ms, ImageFormat.Png); pngs.Add(ms.ToArray()); }
        using (var fs = new FileStream(path, FileMode.Create))
        using (var w = new BinaryWriter(fs))
        {
            w.Write((short)0); w.Write((short)1); w.Write((short)sizes.Length);
            int offset = 6 + 16 * sizes.Length;
            for (int i = 0; i < sizes.Length; i++)
            {
                w.Write((byte)(sizes[i] >= 256 ? 0 : sizes[i]));
                w.Write((byte)(sizes[i] >= 256 ? 0 : sizes[i]));
                w.Write((byte)0); w.Write((byte)0);
                w.Write((short)1); w.Write((short)32);
                w.Write(pngs[i].Length); w.Write(offset);
                offset += pngs[i].Length;
            }
            foreach (var p in pngs) w.Write(p);
        }
    }
}

// ------------------------------------------------------------------ --whoami

// Remonte les processus parents jusqu'a AfterFX.exe (appele par system.callSystem depuis After Effects),
// et demarre l'application, detachee, si elle ne tourne pas.
static class WhoAmI
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct PROCESSENTRY32
    {
        public uint dwSize, cntUsage, th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID, cntThreads, th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
    }

    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snap, ref PROCESSENTRY32 pe);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32NextW(IntPtr snap, ref PROCESSENTRY32 pe);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

    public static int Run(string outFile)
    {
        var parent = new Dictionary<uint, uint>();
        var name = new Dictionary<uint, string>();
        IntPtr snap = CreateToolhelp32Snapshot(2, 0);
        var pe = new PROCESSENTRY32();
        pe.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
        if (Process32FirstW(snap, ref pe))
        {
            do { parent[pe.th32ProcessID] = pe.th32ParentProcessID; name[pe.th32ProcessID] = pe.szExeFile; }
            while (Process32NextW(snap, ref pe));
        }
        CloseHandle(snap);

        uint pid = (uint)Process.GetCurrentProcess().Id;
        uint found = 0;
        for (int i = 0; i < 16 && parent.ContainsKey(pid); i++)
        {
            pid = parent[pid];
            string n;
            if (name.TryGetValue(pid, out n) && n.Equals("AfterFX.exe", StringComparison.OrdinalIgnoreCase)) { found = pid; break; }
        }
        string tmp = outFile + ".tmp";
        File.WriteAllText(tmp, found.ToString());
        if (File.Exists(outFile)) File.Delete(outFile);
        File.Move(tmp, outFile);

        // ShellExecute : l'application n'herite pas des poignees de system.callSystem, qui sinon
        // attendrait sa fermeture et gelerait After Effects.
        if (found != 0)
        {
            try
            {
                bool running;
                try { using (Mutex.OpenExisting(Program.MutexName)) running = true; }
                catch (WaitHandleCannotBeOpenedException) { running = false; }
                if (!running)
                {
                    var psi = new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName, "--tray");
                    psi.UseShellExecute = true;
                    psi.WorkingDirectory = Program.Home;
                    Process.Start(psi);
                }
            }
            catch (Exception e) { Program.Log("whoami " + found + ": " + e.Message); }
        }
        return found == 0 ? 1 : 0;
    }
}

// ------------------------------------------------------------------ installation dans After Effects

static class Setup
{
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string AppKey = @"Software\AECopy";
    public const string StubName = "AECopy_startup.jsx";

    public static string StubPath { get { return Path.Combine(Program.Home, StubName); } }

    static string StubSource()
    {
        string home = Program.Home.Replace('\\', '/');
        return "// Author: Ilhan Turan - https://ilhanturan.fr\n" +
               "// AECopy v" + Program.Version + " - loads AECopy into After Effects (Scripts\\Startup, or injected by AECopy.exe).\n" +
               "(function () {\n" +
               "    var home = \"" + home + "\";\n" +
               "    var f = new File(home + \"/AECopy.jsx\");\n" +
               "    if (!f.exists) return;\n" +
               "    $.global.AECOPY_HOME = new Folder(home).fsName;\n" +
               "    try { $.evalFile(f); } catch (e) {}\n" +
               "})();\n";
    }

    // Script de demarrage dans Scripts\Startup de chaque version d'After Effects trouvee (dossier utilisateur,
    // sans droits admin) ; retire celui de l'ancienne version AE Transfer.
    public static List<string> InstallStartupScripts()
    {
        var done = new List<string>();
        string stub = StubSource();
        try { File.WriteAllText(StubPath, stub, new UTF8Encoding(false)); } catch { }
        string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"Adobe\After Effects");
        if (!Directory.Exists(root)) return done;
        foreach (var dir in Directory.GetDirectories(root))
        {
            string ver = Path.GetFileName(dir);
            double v;
            if (!double.TryParse(ver, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out v)) continue;
            // Un dossier de version sans preferences est un reste d'ancienne installation.
            if (!File.Exists(Path.Combine(dir, "Adobe After Effects " + ver + " Prefs.txt"))) continue;
            string startup = Path.Combine(dir, @"Scripts\Startup");
            try
            {
                Directory.CreateDirectory(startup);
                string target = Path.Combine(startup, StubName);
                if (!File.Exists(target) || File.ReadAllText(target) != stub) File.WriteAllText(target, stub, new UTF8Encoding(false));
                string old = Path.Combine(startup, "AETransfer_startup.jsx");
                if (File.Exists(old)) File.Delete(old);
                done.Add(ver);
            }
            catch (Exception e) { Program.Log("startup script " + ver + ": " + e.Message); }
        }
        return done;
    }

    public static bool StartWithWindows
    {
        get
        {
            using (var k = Registry.CurrentUser.OpenSubKey(RunKey)) return k != null && k.GetValue("AECopy") != null;
        }
        set
        {
            using (var k = Registry.CurrentUser.CreateSubKey(RunKey))
            {
                if (value) k.SetValue("AECopy", "\"" + Process.GetCurrentProcess().MainModule.FileName + "\" --tray");
                else k.DeleteValue("AECopy", false);
            }
        }
    }

    public static bool GetFlag(string name, bool dflt)
    {
        using (var k = Registry.CurrentUser.OpenSubKey(AppKey))
        {
            object v = k == null ? null : k.GetValue(name);
            return v == null ? dflt : Convert.ToInt32(v) != 0;
        }
    }

    public static void SetFlag(string name, bool value)
    {
        using (var k = Registry.CurrentUser.CreateSubKey(AppKey)) k.SetValue(name, value ? 1 : 0, RegistryValueKind.DWord);
    }

    // Premier lancement : demarrage avec Windows active par defaut ; ensuite c'est le choix de l'utilisateur.
    public static void FirstRun()
    {
        if (GetFlag("Configured", false)) return;
        try { StartWithWindows = true; } catch { }
        SetFlag("Configured", true);
        // Ancienne version : raccourci de demarrage et dossier de travail.
        try
        {
            string lnk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "AE Transfer.lnk");
            if (File.Exists(lnk)) File.Delete(lnk);
        }
        catch { }
    }
}

// ------------------------------------------------------------------ After Effects ouverts

class AeInstance
{
    public uint Pid;
    public string Exe;
    public string Version;   // « 2020 », « 2025 »...
    public string Project;
    public bool Secondary;   // lance avec -m
    public string State = "checking"; // connected, noscript, busy, checking
}

class Relay
{
    const int WH_KEYBOARD_LL = 13, WM_KEYDOWN = 0x100, WM_SYSKEYDOWN = 0x104;
    const int VK_C = 0x43, VK_V = 0x56, VK_CONTROL = 0x11, VK_SHIFT = 0x10, VK_MENU = 0x12, VK_LWIN = 0x5B, VK_RWIN = 0x5C;

    delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr hMod, uint threadId);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll")] static extern IntPtr GetClipboardOwner();
    [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);

    readonly HookProc hookProc;
    IntPtr hook;
    readonly BlockingCollection<Action> work = new BlockingCollection<Action>();
    readonly Dictionary<uint, bool> isAeCache = new Dictionary<uint, bool>();
    readonly object sendLock = new object();
    int cmdCounter = new Random().Next(1000, 100000);

    volatile uint markPid;
    volatile int markState;      // 0 rien, 1 en cours, 2 pret
    volatile uint markClipSeq;

    public volatile bool Enabled = true;
    public bool Awake { get { return hook != IntPtr.Zero; } }
    public Action<string, bool> Notify = delegate { };
    // Barre de progression : (texte, -1 anime | 0..1 avancement | -2 fini).
    public Action<string, float> Progress = delegate { };

    public Relay()
    {
        hookProc = OnKey;
        mouseProc = OnMouse;
        var worker = new Thread(delegate ()
        {
            foreach (var a in work.GetConsumingEnumerable())
            {
                try { a(); } catch (Exception e) { Program.Log("error: " + e.Message); Notify("Error: " + e.Message, true); }
            }
        });
        worker.IsBackground = true;
        worker.Start();
    }

    public bool Wake()
    {
        if (hook != IntPtr.Zero) return true;
        hook = SetWindowsHookEx(WH_KEYBOARD_LL, hookProc, GetModuleHandle(null), 0);
        mouseHook = SetWindowsHookEx(WH_MOUSE_LL, mouseProc, GetModuleHandle(null), 0);
        Program.Log("After Effects detected: " + (hook != IntPtr.Zero ? "active" : "keyboard hook FAILED, error " + Marshal.GetLastWin32Error()) +
            (mouseHook == IntPtr.Zero ? " (mouse hook FAILED: no drag & drop)" : ""));
        return hook != IntPtr.Zero;
    }

    public void Sleep()
    {
        if (hook == IntPtr.Zero) return;
        UnhookWindowsHookEx(hook);
        hook = IntPtr.Zero;
        if (mouseHook != IntPtr.Zero) { UnhookWindowsHookEx(mouseHook); mouseHook = IntPtr.Zero; }
        dragFrom = 0;
        HideTip();
        markState = 0;
        markPid = 0;
        lock (isAeCache) isAeCache.Clear(); // les numeros de processus seront reutilises
        Program.Log("no After Effects left: sleeping");
    }

    public void Stop()
    {
        if (hook != IntPtr.Zero) { UnhookWindowsHookEx(hook); hook = IntPtr.Zero; }
        if (mouseHook != IntPtr.Zero) { UnhookWindowsHookEx(mouseHook); mouseHook = IntPtr.Zero; }
        work.CompleteAdding();
    }

    // ---------------------------------------------------------------- glisser-deposer entre After Effects

    const int WH_MOUSE_LL = 14, WM_MOUSEMOVE = 0x200, WM_LBUTTONDOWN = 0x201, WM_LBUTTONUP = 0x202;
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);

    readonly HookProc mouseProc;
    IntPtr mouseHook;
    public volatile bool DragEnabled = true;
    // Etiquette pres du curseur (appelees sur le fil de l'interface, celui des hooks).
    public Action<string, int, int> ShowTip = delegate { };
    public Action HideTip = delegate { };

    uint dragFrom, hoverPid;
    int downX, downY, downTick;
    bool dragging;
    readonly Dictionary<uint, string> versionCache = new Dictionary<uint, string>();

    uint PidAt(POINT pt)
    {
        IntPtr w = WindowFromPoint(pt);
        if (w == IntPtr.Zero) return 0;
        IntPtr root = GetAncestor(w, 2); // GA_ROOT
        uint pid;
        GetWindowThreadProcessId(root != IntPtr.Zero ? root : w, out pid);
        return pid;
    }

    string VersionOf(uint pid)
    {
        string v;
        if (versionCache.TryGetValue(pid, out v)) return v;
        v = "";
        try
        {
            using (var p = Process.GetProcessById((int)pid))
            {
                var m = System.Text.RegularExpressions.Regex.Match(p.MainModule.FileName, @"After Effects (\d{4})");
                if (m.Success) v = " " + m.Groups[1].Value;
            }
        }
        catch { }
        versionCache[pid] = v;
        return v;
    }

    // Bouton gauche enfonce dans un After Effects, relache au-dessus d'un AUTRE : copie puis collage.
    // Garde-fous : 40 px de deplacement, 0,2 s, relache dans la meme fenetre = rien.
    IntPtr OnMouse(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0 && Enabled && DragEnabled)
        {
            int msg = (int)wParam;
            var pt = (POINT)Marshal.PtrToStructure(lParam, typeof(POINT));
            if (msg == WM_LBUTTONDOWN)
            {
                uint pid = PidAt(pt);
                dragFrom = (pid != 0 && IsAe(pid)) ? pid : 0;
                downX = pt.X; downY = pt.Y; downTick = Environment.TickCount;
                dragging = false; hoverPid = 0;
            }
            else if (msg == WM_MOUSEMOVE && dragFrom != 0)
            {
                if (!dragging && Math.Abs(pt.X - downX) + Math.Abs(pt.Y - downY) > 40) dragging = true;
                if (dragging)
                {
                    uint over = PidAt(pt);
                    if (over != 0 && over != dragFrom && IsAe(over))
                    {
                        hoverPid = over;
                        ShowTip("Drop to paste into After Effects" + VersionOf(over), pt.X, pt.Y);
                    }
                    else if (hoverPid != 0) { hoverPid = 0; HideTip(); }
                }
            }
            else if (msg == WM_LBUTTONUP && dragFrom != 0)
            {
                uint from = dragFrom;
                dragFrom = 0;
                if (hoverPid != 0) { hoverPid = 0; HideTip(); }
                uint over = PidAt(pt);
                if (dragging && over != 0 && over != from && IsAe(over) && Environment.TickCount - downTick > 200)
                {
                    uint to = over;
                    markPid = from;
                    markState = 1;
                    work.Add(delegate { Program.Log("drag from After Effects " + from + " to " + to); DragDrop(from, to); });
                }
                dragging = false;
            }
        }
        return CallNextHookEx(mouseHook, nCode, wParam, lParam);
    }

    void DragDrop(uint from, uint to)
    {
        DoCopy(from);
        if (markState != 2) { Notify("Nothing to drop: select layers, effects or a composition, then drag.", true); return; }
        // La cible passe devant : on voit le resultat, et une reinjection (-r) l'atteint.
        IntPtr win = IntPtr.Zero;
        try { using (var p = Process.GetProcessById((int)to)) win = p.MainWindowHandle; } catch { }
        if (win != IntPtr.Zero) Activate(win);
        DoPaste(to, "dragpaste");
    }

    static bool Down(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }

    public bool IsAe(uint pid)
    {
        bool v;
        lock (isAeCache) { if (isAeCache.TryGetValue(pid, out v)) return v; }
        try { using (var p = Process.GetProcessById((int)pid)) v = p.ProcessName.Equals("AfterFX", StringComparison.OrdinalIgnoreCase); }
        catch { v = false; }
        lock (isAeCache) { isAeCache[pid] = v; }
        return v;
    }

    public static uint ForegroundPid()
    {
        uint pid;
        GetWindowThreadProcessId(GetForegroundWindow(), out pid);
        return pid;
    }

    bool ProcessAlive(uint pid)
    {
        if (pid == 0) return false;
        try { using (var p = Process.GetProcessById((int)pid)) return !p.HasExited && IsAe(pid); } catch { return false; }
    }

    // Le presse-papiers n'a pas ete repris par une autre application depuis la copie dans After Effects.
    bool ClipboardStillOurs()
    {
        if (GetClipboardSequenceNumber() == markClipSeq) return true;
        uint owner;
        GetWindowThreadProcessId(GetClipboardOwner(), out owner);
        return owner != 0 && IsAe(owner);
    }

    IntPtr OnKey(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0 && Enabled && ((int)wParam == WM_KEYDOWN || (int)wParam == WM_SYSKEYDOWN))
        {
            int vk = Marshal.ReadInt32(lParam);
            if ((vk == VK_C || vk == VK_V) && Down(VK_CONTROL) && !Down(VK_SHIFT) && !Down(VK_MENU) && !Down(VK_LWIN) && !Down(VK_RWIN))
            {
                uint pid = ForegroundPid();
                if (pid != 0 && IsAe(pid))
                {
                    if (vk == VK_C)
                    {
                        markPid = pid;
                        markState = 1;
                        work.Add(delegate { Program.Log("Ctrl+C in After Effects " + pid); DoCopy(pid); });
                    }
                    else if (markState != 0 && markPid != pid && (markState == 1 || ClipboardStillOurs()))
                    {
                        uint target = pid;
                        work.Add(delegate { Program.Log("Ctrl+V in After Effects " + target + ": paste from " + markPid); DoPaste(target); });
                        return (IntPtr)1; // le Ctrl+V natif n'atteint pas After Effects
                    }
                }
            }
        }
        return CallNextHookEx(hook, nCode, wParam, lParam);
    }

    // ---------------------------------------------------------------- boite aux lettres

    // Depose une commande pour un After Effects et attend sa reponse (null si delai depasse).
    // Un seul envoi a la fois : le fichier de commande d'un After Effects est unique.
    // Reponse de Send quand le script n'a pas pris la commande a temps (il est arrete) : il faut le reinjecter.
    public const string NoPickup = "\u0000nopickup";

    // pickupMs > 0 : si la commande n'est pas prise (fichier toujours la) dans ce delai, renvoie NoPickup
    // au lieu d'attendre toute la duree : le script lit sa boite toutes les 100 ms quand il est vivant.
    public string Send(uint pid, string verb, int timeoutMs, int pickupMs = 0)
    {
        lock (sendLock)
        {
            int id = Interlocked.Increment(ref cmdCounter);
            string cmd = Path.Combine(Program.Root, "cmd_" + pid + ".txt");
            string done = Path.Combine(Program.Root, "done_" + id + ".txt");
            string tmp = cmd + ".w";
            File.WriteAllText(tmp, verb + " " + id, new UTF8Encoding(false));
            if (File.Exists(cmd)) File.Delete(cmd);
            File.Move(tmp, cmd);
            var sw = Stopwatch.StartNew();
            string res = null;
            bool picked = false;
            while (sw.ElapsedMilliseconds < timeoutMs)
            {
                if (File.Exists(done))
                {
                    try { res = File.ReadAllText(done, Encoding.UTF8); File.Delete(done); break; }
                    catch (IOException) { }
                }
                if (!picked && !File.Exists(cmd)) picked = true;
                if (!picked && pickupMs > 0 && sw.ElapsedMilliseconds > pickupMs)
                {
                    try { if (File.Exists(cmd)) File.Delete(cmd); } catch { }
                    return NoPickup;
                }
                if (!ProcessAlive(pid)) break;
                Thread.Sleep(15);
            }
            // Commande jamais lue : on la retire pour qu'un After Effects reveille ne l'execute pas en retard.
            if (res == null) { try { if (File.Exists(cmd)) File.Delete(cmd); } catch { } }
            return res;
        }
    }

    // Clear cache : vide le dossier mailbox (journaux, copie en cours, reponses et fiches oubliees) comme
    // a neuf. Seules restent les fiches inst_ des After Effects ouverts : sans elles, plus de connexion.
    public int ClearCache()
    {
        lock (sendLock)
        {
            markState = 0;
            var live = new HashSet<string>();
            foreach (var p in Process.GetProcessesByName("AfterFX")) using (p) live.Add("inst_" + p.Id + ".txt");
            int n = 0;
            if (!Directory.Exists(Program.Root)) return 0;
            foreach (var f in Directory.GetFiles(Program.Root))
            {
                if (live.Contains(Path.GetFileName(f))) continue;
                try { File.Delete(f); n++; } catch { }
            }
            return n;
        }
    }

    // Coupe la boucle du script dans chaque After Effects connecte.
    public void StopAgents()
    {
        foreach (var p in Process.GetProcessesByName("AfterFX"))
        {
            uint pid = (uint)p.Id;
            p.Dispose();
            if (File.Exists(Path.Combine(Program.Root, "inst_" + pid + ".txt"))) Send(pid, "stop", 1500);
        }
    }

    public bool Ping(uint pid, int timeoutMs)
    {
        if (!File.Exists(Path.Combine(Program.Root, "inst_" + pid + ".txt"))) return false;
        return Send(pid, "ping", timeoutMs) != null;
    }

    // Injecte le script par AfterFX.exe -r. After Effects coupe pour de bon les taches de script des qu'il
    // ouvre une fenetre (accueil, alerte...) : aucun script ne peut s'en remettre seul. -r part vers
    // l'After Effects de cette version actif le plus recemment.
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int cmd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [StructLayout(LayoutKind.Sequential)] struct WINRECT { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] struct PLACEMENT { public int length, flags, showCmd; public POINT ptMin, ptMax; public WINRECT rcNormal; }
    [DllImport("user32.dll")] static extern bool GetWindowPlacement(IntPtr hwnd, ref PLACEMENT pl);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out WINRECT r);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int w, int h, uint flags);

    // AfterFX.exe -r fait sortir After Effects du plein ecran (fenetre remise a sa taille normale) :
    // on releve la fenetre avant et on la remet comme elle etait.
    static int WindowState(IntPtr win, out WINRECT rect)
    {
        var pl = new PLACEMENT { length = Marshal.SizeOf(typeof(PLACEMENT)) };
        rect = new WINRECT();
        if (win == IntPtr.Zero || !GetWindowPlacement(win, ref pl) || !GetWindowRect(win, out rect)) return 0;
        return pl.showCmd;
    }

    static void RestoreWindow(IntPtr win, int show, WINRECT rect)
    {
        if (show == 0) return;
        WINRECT now;
        int nowShow = WindowState(win, out now);
        if (nowShow == show && now.L == rect.L && now.T == rect.T && now.R == rect.R && now.B == rect.B) return;
        if (show == 3) ShowWindow(win, 3); // SW_MAXIMIZE
        else if (show == 1) SetWindowPos(win, IntPtr.Zero, rect.L, rect.T, rect.R - rect.L, rect.B - rect.T, 0x0014); // NOZORDER | NOACTIVATE
        else return;
        Program.Log("window of After Effects put back (" + (show == 3 ? "maximized" : "same place") + ")");
    }

    // Met une fenetre au premier plan meme quand AECopy ne l'est plus (Reload enchaine plusieurs
    // After Effects) : on s'attache un instant a la file d'entree de la fenetre active.
    public static void Activate(IntPtr win)
    {
        if (win == IntPtr.Zero) return;
        if (IsIconic(win)) ShowWindow(win, 9); // SW_RESTORE
        uint dummy;
        uint fgThread = GetWindowThreadProcessId(GetForegroundWindow(), out dummy);
        uint me = GetCurrentThreadId();
        bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
        BringWindowToTop(win);
        SetForegroundWindow(win);
        if (attached) AttachThreadInput(me, fgThread, false);
    }

    // activate : avec deux fenetres de la meme version, -r part vers celle utilisee en dernier ; on met
    // d'abord la bonne au premier plan.
    public bool Inject(uint pid, int waitMs, bool activate = false)
    {
        if (!ProcessAlive(pid)) return false;
        string exe;
        IntPtr win;
        try { using (var p = Process.GetProcessById((int)pid)) { exe = p.MainModule.FileName; win = p.MainWindowHandle; } } catch { return false; }
        if (activate && win != IntPtr.Zero)
        {
            // -r part vers l'After Effects active en dernier : il faut que l'activation soit prise en compte
            // par After Effects (0,3 s ne suffisait pas, 0,8 s oui).
            for (int attempt = 0; attempt < 3 && ForegroundPid() != pid; attempt++)
            {
                Activate(win);
                for (int i = 0; i < 20 && ForegroundPid() != pid; i++) Thread.Sleep(50);
            }
            if (ForegroundPid() != pid) Program.Log("could not bring " + pid + " to the front");
            Thread.Sleep(900);
        }
        // Une seule injection a la fois (Reload et le lancement peuvent se croiser).
        if (!Monitor.TryEnter(injectLock, waitMs)) return Ping(pid, 800);
        try
        {
            Program.Log("inject into " + pid);
            // Chemin SANS guillemets : AfterFX.exe -r "chemin" n'execute rien (verifie sous AE 2020) ;
            // s'il contient des espaces, son nom court Windows n'en a pas.
            string stub = Setup.StubPath;
            if (stub.IndexOf(' ') >= 0)
            {
                var sb = new StringBuilder(520);
                if (GetShortPathName(stub, sb, sb.Capacity) > 0) stub = sb.ToString();
            }
            var psi = new ProcessStartInfo(exe, "-r " + stub);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            WINRECT rect;
            int show = WindowState(win, out rect);
            try { Process.Start(psi); } catch (Exception e) { Program.Log("inject failed: " + e.Message); return false; }
            var sw = Stopwatch.StartNew();
            try
            {
                while (sw.ElapsedMilliseconds < waitMs)
                {
                    Thread.Sleep(500);
                    if (Ping(pid, 800)) { Program.Log("connected to " + pid); return true; }
                }
                Program.Log("inject into " + pid + ": no answer");
                return false;
            }
            finally { RestoreWindow(win, show, rect); }
        }
        finally { Monitor.Exit(injectLock); }
    }

    readonly object injectLock = new object();
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern int GetShortPathName(string path, StringBuilder shortPath, int size);

    // Envoi direct (sans ping prealable). Pas de reinjection ici : -r fait sortir After Effects du plein
    // ecran, on n'injecte qu'au lancement d'AECopy et au Reload. Renvoie null si le script est arrete.
    string SendOrFail(uint pid, string verb, ref bool unreachable)
    {
        string res = Send(pid, verb, 300000, 1200);
        if (res != NoPickup) return res;
        Program.Log(verb + ": no answer from " + pid);
        unreachable = true;
        return null;
    }

    const string NotConnected = "AECopy is not connected to this After Effects (a window opened in it stops AECopy). Click Reload in AECopy.";

    void DoCopy(uint pid)
    {
        Progress("Copying...", -1);
        try { DoCopyCore(pid); } finally { Progress(null, -2); }
    }

    void DoPaste(uint target, string verb = "paste")
    {
        Progress("Pasting...", -1);
        try { DoPasteCore(target, verb); } finally { Progress(null, -2); }
    }

    void DoCopyCore(uint pid)
    {
        var sw = Stopwatch.StartNew();
        bool unreachable = false;
        // Styles par caractere d'un texte d'AE 2020 : leur lecture pose un element temporaire dans le projet,
        // utile seulement si un After Effects 2024+ peut les recevoir.
        string res = SendOrFail(pid, NewerAeOpen(pid) ? "copystyles" : "copy", ref unreachable);
        if (unreachable)
        {
            if (markPid == pid) markState = 0;
            Notify(NotConnected, true);
            return;
        }
        if (markPid != pid) return; // une copie plus recente a pris la place
        long ms = sw.ElapsedMilliseconds;
        // Laisse After Effects finir sa propre copie avant de relever le numero du presse-papiers.
        Thread.Sleep(150);
        markClipSeq = GetClipboardSequenceNumber();
        markState = (res != null && res.StartsWith("ok")) ? 2 : 0;
        Program.Log("copy in " + pid + " (" + ms + " ms): " + (res ?? "no reply").Replace("\n", " | "));
        if (res != null && res.StartsWith("err")) Notify("Copy failed: " + Clean(res), true);
    }

    static bool NewerAeOpen(uint except)
    {
        foreach (var p in Process.GetProcessesByName("AfterFX"))
            using (p)
            {
                if ((uint)p.Id == except) continue;
                string exe = "";
                try { exe = p.MainModule.FileName; } catch { }
                var m = System.Text.RegularExpressions.Regex.Match(exe, @"After Effects (\d{4})");
                if (m.Success && int.Parse(m.Groups[1].Value) >= 2024) return true;
            }
        return false;
    }

    void DoPasteCore(uint target, string verb)
    {
        var sw = Stopwatch.StartNew();
        for (int i = 0; i < 600 && markState == 1; i++) Thread.Sleep(20);
        if (markState != 2) { Notify("Nothing to paste: select layers, effects or a composition before Ctrl+C.", true); return; }
        bool unreachable = false;
        string res = SendOrFail(target, verb, ref unreachable);
        if (unreachable) { Notify(NotConnected, true); return; }
        Program.Log("paste in " + target + " (" + sw.ElapsedMilliseconds + " ms): " + (res ?? "no reply").Replace("\n", " | "));
        if (res == null) { Notify("This After Effects did not answer (is a dialog open?).", true); return; }
        if (!res.StartsWith("ok")) { Notify("Paste failed: " + Clean(res), true); return; }
        string[] lines = res.Split('\n');
        if (lines.Length > 1)
            Notify("Pasted with " + (lines.Length - 1) + " warning(s): " + lines[1] + (lines.Length > 2 ? " ..." : ""), true);
    }

    static string Clean(string s)
    {
        s = s.StartsWith("err ") ? s.Substring(4) : s;
        int nl = s.IndexOf('\n');
        return nl >= 0 ? s.Substring(0, nl) : s;
    }

    // Etat de chaque After Effects ouvert (appele hors du fil de l'interface).
    public List<AeInstance> Scan()
    {
        var list = new List<AeInstance>();
        foreach (var p in Process.GetProcessesByName("AfterFX"))
        {
            using (p)
            {
                var ae = new AeInstance { Pid = (uint)p.Id };
                try { ae.Exe = p.MainModule.FileName; } catch { ae.Exe = ""; }
                var m = System.Text.RegularExpressions.Regex.Match(ae.Exe, @"After Effects (\d{4})");
                ae.Version = m.Success ? m.Groups[1].Value : "?";
                string title = "";
                try { title = p.MainWindowTitle; } catch { }
                // Sans fenetre principale : AfterFX.exe -r de passage, ou After Effects encore au demarrage.
                if (title == "") continue;
                int dash = title.IndexOf(" - ");
                ae.Project = dash >= 0 ? Path.GetFileName(title.Substring(dash + 3).TrimEnd(' ', '*')) : "";
                list.Add(ae);
            }
        }
        // -m : celui lance en second de la meme version.
        foreach (var a in list)
            foreach (var b in list)
                if (a != b && a.Version == b.Version && a.Pid != b.Pid)
                {
                    try { using (var pa = Process.GetProcessById((int)a.Pid)) using (var pb = Process.GetProcessById((int)b.Pid)) if (pa.StartTime > pb.StartTime) a.Secondary = true; } catch { }
                }
        foreach (var a in list) a.State = Ping(a.Pid, 900) ? "connected" : "noscript";
        list.Sort(delegate (AeInstance x, AeInstance y) { return string.Compare(x.Version + x.Pid, y.Version + y.Pid, StringComparison.Ordinal); });
        return list;
    }
}

// ------------------------------------------------------------------ interface

static class Theme
{
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    public static readonly Color Back = Color.FromArgb(0x1E, 0x1E, 0x22);
    public static readonly Color Card = Color.FromArgb(0x27, 0x27, 0x2D);
    public static readonly Color CardHover = Color.FromArgb(0x2E, 0x2E, 0x36);
    public static readonly Color Line = Color.FromArgb(0x34, 0x34, 0x3C);
    public static readonly Color Text = Color.FromArgb(0xEC, 0xEC, 0xF0);
    public static readonly Color Dim = Color.FromArgb(0x92, 0x92, 0x9E);
    public static readonly Color Green = Color.FromArgb(0x4A, 0xD6, 0x7A);
    public static readonly Color Orange = Color.FromArgb(0xF0, 0xA9, 0x45);
    public static readonly Color AccentDeep = Color.FromArgb(0x5B, 0x47, 0xD6);
    public static readonly Color Red = Color.FromArgb(0xC9, 0x3B, 0x3B);
    public static readonly Font Body = new Font("Segoe UI", 9f);
    public static readonly Font Small = new Font("Segoe UI", 8.25f);
    public static readonly Font Title = new Font("Segoe UI Semibold", 15f);
    public static readonly Font Bold = new Font("Segoe UI Semibold", 9f);
    public static readonly Font Badge = new Font("Segoe UI Semibold", 8.25f);

    public static void DarkTitle(Form f)
    {
        f.HandleCreated += delegate { int on = 1; try { if (DwmSetWindowAttribute(f.Handle, 20, ref on, 4) != 0) DwmSetWindowAttribute(f.Handle, 19, ref on, 4); } catch { } };
    }

    public static GraphicsPath Round(RectangleF r, float rad)
    {
        var p = new GraphicsPath();
        float d = Math.Min(rad * 2, Math.Min(r.Width, r.Height));
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }

    public static Color Mix(Color a, Color b, float t)
    {
        return Color.FromArgb((int)(a.R + (b.R - a.R) * t), (int)(a.G + (b.G - a.G) * t), (int)(a.B + (b.B - a.B) * t));
    }

    public static PictureBox MakeLogo(int size, ToolTip tip)
    {
        var pb = new PictureBox { Image = Logo.Draw(size), Size = new Size(size, size), Cursor = Cursors.Hand, BackColor = Color.Transparent };
        tip.SetToolTip(pb, "ilhanturan.fr");
        pb.Click += delegate { OpenSite(); };
        return pb;
    }

    public static void OpenSite()
    {
        try { Process.Start(new ProcessStartInfo(Program.Website) { UseShellExecute = true }); } catch { }
    }
}

// Bouton arrondi dessine (survol, appui, desactive).
class RoundButton : Control
{
    bool hover, down;
    public bool Accent;
    public bool Danger; // rouge (Quit)

    public RoundButton(string text, bool accent)
    {
        Text = text; Accent = accent;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.SupportsTransparentBackColor, true);
        BackColor = Color.Transparent;
        Font = Theme.Bold;
        Cursor = Cursors.Hand;
        Size = new Size(72, 26);
    }

    protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hover = false; down = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnMouseDown(MouseEventArgs e) { down = true; Invalidate(); base.OnMouseDown(e); }
    protected override void OnMouseUp(MouseEventArgs e) { down = false; Invalidate(); base.OnMouseUp(e); }
    protected override void OnEnabledChanged(EventArgs e) { Cursor = Enabled ? Cursors.Hand : Cursors.Default; Invalidate(); base.OnEnabledChanged(e); }
    protected override void OnTextChanged(EventArgs e) { Invalidate(); base.OnTextChanged(e); }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        var r = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
        Color fill, border, text;
        if (!Enabled) { fill = Theme.Card; border = Theme.Line; text = Theme.Dim; }
        else if (Danger)
        {
            fill = down ? Theme.Mix(Theme.Red, Color.Black, 0.2f) : hover ? Theme.Mix(Theme.Red, Color.White, 0.12f) : Theme.Red;
            border = fill; text = Color.White;
        }
        else if (Accent)
        {
            fill = down ? Theme.Mix(Theme.AccentDeep, Color.Black, 0.2f) : hover ? Theme.Mix(Theme.AccentDeep, Color.White, 0.12f) : Theme.AccentDeep;
            border = fill; text = Color.White;
        }
        else
        {
            fill = down ? Theme.Line : hover ? Theme.CardHover : Theme.Card;
            border = Theme.Line; text = Theme.Text;
        }
        using (var path = Theme.Round(r, Height / 2f - 1))
        {
            using (var b = new SolidBrush(fill)) g.FillPath(b, path);
            using (var p = new Pen(border)) g.DrawPath(p, path);
        }
        TextRenderer.DrawText(g, Text, Font, ClientRectangle, text, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
    }
}

// Interrupteur a glissiere avec son libelle.
class Toggle : Control
{
    bool on, hover;
    public event EventHandler CheckedChanged;

    public Toggle(string text)
    {
        Text = text;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.SupportsTransparentBackColor, true);
        BackColor = Color.Transparent;
        Font = Theme.Body;
        Cursor = Cursors.Hand;
        Size = new Size(170, 24);
    }

    public bool Checked
    {
        get { return on; }
        set { if (on == value) return; on = value; Invalidate(); if (CheckedChanged != null) CheckedChanged(this, EventArgs.Empty); }
    }

    protected override void OnClick(EventArgs e) { Checked = !Checked; base.OnClick(e); }
    protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        var track = new RectangleF(0.5f, (Height - 18) / 2f, 32, 18);
        Color fill = on ? Theme.AccentDeep : (hover ? Theme.Line : Theme.Mix(Theme.Line, Theme.Back, 0.3f));
        using (var path = Theme.Round(track, 9))
        using (var b = new SolidBrush(fill)) g.FillPath(b, path);
        float kx = on ? track.Right - 16 : track.X + 2;
        using (var b = new SolidBrush(on ? Color.White : Theme.Dim)) g.FillEllipse(b, kx, track.Y + 2, 14, 14);
        TextRenderer.DrawText(g, Text, Font, new Rectangle(42, 0, Width - 42, Height), Theme.Text, TextFormatFlags.VerticalCenter | TextFormatFlags.Left | TextFormatFlags.NoPrefix);
    }
}

// Barre de chargement fine : trait discret au repos, segment qui glisse (en cours) ou remplissage (avancement).
class ProgressLine : Control
{
    float value = -2, phase;
    readonly System.Windows.Forms.Timer anim = new System.Windows.Forms.Timer { Interval = 16 };

    public ProgressLine()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint, true);
        anim.Tick += delegate { phase = (phase + 0.012f) % 1.4f; Invalidate(); };
    }

    public void Set(float v)
    {
        value = v;
        anim.Enabled = v == -1;
        Invalidate();
    }

    protected override void Dispose(bool disposing) { if (disposing) anim.Dispose(); base.Dispose(disposing); }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(Theme.Back);
        if (value == -2)
        {
            using (var b = new SolidBrush(Theme.Line)) g.FillRectangle(b, 0, Height - 1, Width, 1);
            return;
        }
        using (var path = Theme.Round(new RectangleF(0, 0, Width, Height), Height / 2f))
        using (var b = new SolidBrush(Theme.Line)) g.FillPath(b, path);
        float x0, w;
        if (value < 0) { w = Width * 0.3f; x0 = (phase - 0.3f) * Width; }
        else { x0 = 0; w = Math.Max(Height, Width * Math.Min(1f, value)); }
        var seg = RectangleF.Intersect(new RectangleF(x0, 0, w, Height), new RectangleF(0, 0, Width, Height));
        if (seg.Width <= 0) return;
        using (var path = Theme.Round(seg, Height / 2f))
        using (var b = new LinearGradientBrush(new RectangleF(0, 0, Width, Height), Theme.AccentDeep, Logo.Accent, 0f))
            g.FillPath(b, path);
    }
}

// Pastille d'etat : point de couleur + texte.
class StatusPill : Control
{
    Color color = Theme.Green;

    public StatusPill()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.SupportsTransparentBackColor, true);
        BackColor = Color.Transparent;
        Font = Theme.Bold;
        Size = new Size(124, 28);
    }

    public void Set(string text, Color c) { Text = text; color = c; Invalidate(); }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        int tw = TextRenderer.MeasureText(Text, Font).Width;
        float w = tw + 34, x = Width - w - 0.5f;
        var r = new RectangleF(x, 0.5f, w, Height - 1.5f);
        using (var path = Theme.Round(r, Height / 2f))
        {
            using (var b = new SolidBrush(Theme.Mix(Theme.Back, color, 0.14f))) g.FillPath(b, path);
            using (var p = new Pen(Theme.Mix(Theme.Back, color, 0.45f))) g.DrawPath(p, path);
        }
        using (var b = new SolidBrush(color)) g.FillEllipse(b, x + 12, Height / 2f - 4, 8, 8);
        TextRenderer.DrawText(g, Text, Font, new Rectangle((int)x + 24, 0, tw + 6, Height), color, TextFormatFlags.VerticalCenter | TextFormatFlags.Left);
    }
}

// Une ligne par After Effects : badge de version, projet, etat, bouton Inject si besoin.
class InstanceRow : Control
{
    public readonly AeInstance Ae;
    readonly RoundButton inject;
    bool hover;

    public InstanceRow(AeInstance ae, Action<AeInstance, RoundButton> onInject)
    {
        Ae = ae;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint, true);
        Height = 46;
        BackColor = Theme.Card;
        inject = new RoundButton("Inject", true) { Size = new Size(66, 26) };
        inject.Visible = ae.State != "connected";
        inject.Click += delegate { onInject(Ae, inject); };
        Controls.Add(inject);
    }

    protected override void OnResize(EventArgs e)
    {
        // Appele des le constructeur (Height), avant la creation du bouton.
        if (inject != null) inject.Location = new Point(Width - inject.Width - 12, (Height - inject.Height) / 2);
        base.OnResize(e);
    }
    protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(hover ? Theme.CardHover : Theme.Card);
        // Badge de version.
        var badge = new RectangleF(12, (Height - 22) / 2f, 50, 22);
        using (var path = Theme.Round(badge, 6))
        using (var b = new SolidBrush(Theme.Mix(Theme.Card, Logo.Accent, 0.22f))) g.FillPath(b, path);
        TextRenderer.DrawText(g, Ae.Version, Theme.Badge, Rectangle.Round(badge), Logo.Accent, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
        // Projet (et -m).
        int right = Ae.State == "connected" ? Width - 12 : inject.Left - 10;
        string state = Ae.State == "connected" ? "Connected" : "Not connected";
        Color sc = Ae.State == "connected" ? Theme.Green : Theme.Orange;
        int sw = TextRenderer.MeasureText(state, Theme.Small).Width;
        int sx = right - sw;
        string project = string.IsNullOrEmpty(Ae.Project) ? "Untitled" : Ae.Project;
        TextRenderer.DrawText(g, project, Theme.Body, new Rectangle(72, 6, sx - 90, 18), Theme.Text, TextFormatFlags.Left | TextFormatFlags.EndEllipsis);
        TextRenderer.DrawText(g, "After Effects " + Ae.Version + (Ae.Secondary ? "  ·  second window (-m)" : ""), Theme.Small,
            new Rectangle(72, 24, sx - 90, 16), Theme.Dim, TextFormatFlags.Left | TextFormatFlags.EndEllipsis);
        // Etat.
        using (var b = new SolidBrush(sc)) g.FillEllipse(b, sx - 13, Height / 2f - 3.5f, 7, 7);
        TextRenderer.DrawText(g, state, Theme.Small, new Rectangle(sx, 0, sw + 4, Height), sc, TextFormatFlags.VerticalCenter | TextFormatFlags.Left);
    }
}

// Carte arrondie qui empile les lignes.
class InstanceCard : Panel
{
    readonly Action<AeInstance, RoundButton> onInject;
    readonly Label empty;

    public InstanceCard(Action<AeInstance, RoundButton> onInject)
    {
        this.onInject = onInject;
        DoubleBuffered = true;
        BackColor = Theme.Back;
        Padding = new Padding(1);
        empty = new Label { Text = "No After Effects open", ForeColor = Theme.Dim, Font = Theme.Body, BackColor = Theme.Card, TextAlign = ContentAlignment.MiddleCenter, Dock = DockStyle.Fill };
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using (var path = Theme.Round(new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f), 10))
        {
            using (var b = new SolidBrush(Theme.Card)) e.Graphics.FillPath(b, path);
            using (var p = new Pen(Theme.Line)) e.Graphics.DrawPath(p, path);
        }
    }

    public void SetInstances(List<AeInstance> list)
    {
        SuspendLayout();
        while (Controls.Count > 0) { var c = Controls[0]; Controls.RemoveAt(0); if (c != empty) c.Dispose(); }
        if (list.Count == 0) Controls.Add(empty);
        int y = 4;
        for (int i = 0; i < list.Count && i < 4; i++)
        {
            var row = new InstanceRow(list[i], onInject) { Location = new Point(6, y), Width = Width - 12 };
            Controls.Add(row);
            y += row.Height;
            if (i < list.Count - 1 && i < 3) { Controls.Add(new Panel { BackColor = Theme.Line, Location = new Point(18, y), Size = new Size(Width - 36, 1) }); y += 1; }
        }
        ResumeLayout();
        Invalidate();
    }
}

class MainForm : Form
{
    readonly StatusPill status;
    readonly ProgressLine progress;
    public RoundButton ReloadButton;
    readonly InstanceCard card;
    readonly Label note, count;
    readonly Toggle startWin;
    public Toggle DragToggle;

    public MainForm(AppContext ctx)
    {
        Text = "AECopy";
        Icon = Logo.MakeIcon(32);
        Theme.DarkTitle(this);
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(440, 418);
        BackColor = Theme.Back;
        ForeColor = Theme.Text;
        Font = Theme.Body;
        DoubleBuffered = true;
        var tip = new ToolTip();

        // En-tete : logo (lien vers le site) + nom, etat a droite.
        var logo = Theme.MakeLogo(42, tip);
        logo.Location = new Point(20, 18);
        Controls.Add(logo);
        Controls.Add(new Label { Text = "AECopy", Font = Theme.Title, AutoSize = true, Location = new Point(70, 24), ForeColor = Theme.Text, BackColor = Theme.Back });
        status = new StatusPill { Location = new Point(440 - 20 - 124, 25) };
        Controls.Add(status);
        progress = new ProgressLine { Location = new Point(20, 70), Size = new Size(400, 3) };
        Controls.Add(progress);

        // Liste des After Effects.
        Controls.Add(new Label { Text = "AFTER EFFECTS", Font = Theme.Badge, AutoSize = true, Location = new Point(20, 84), ForeColor = Theme.Dim, BackColor = Theme.Back });
        count = new Label { Text = "", Font = Theme.Small, AutoSize = false, Size = new Size(180, 16), Location = new Point(162, 84), ForeColor = Theme.Dim, TextAlign = ContentAlignment.TopRight, BackColor = Theme.Back };
        Controls.Add(count);
        var reload = ReloadButton = new RoundButton("Reload", false) { Size = new Size(70, 24), Location = new Point(440 - 20 - 70, 79) };
        tip.SetToolTip(reload, "Reload AECopy in every open After Effects");
        reload.Click += delegate { ctx.ReloadAll(reload); };
        Controls.Add(reload);
        card = new InstanceCard(delegate (AeInstance ae, RoundButton b) { ctx.InjectOne(ae, b); }) { Location = new Point(20, 106), Size = new Size(400, 196) };
        Controls.Add(card);
        note = new Label { AutoSize = false, Location = new Point(20, 308), Size = new Size(400, 30), ForeColor = Theme.Dim, Font = Theme.Small, BackColor = Theme.Back };
        Controls.Add(note);

        // Pied : reglages et About.
        Controls.Add(new Panel { BackColor = Theme.Line, Location = new Point(0, 338), Size = new Size(440, 1) });
        startWin = new Toggle("Start with Windows") { Location = new Point(20, 348) };
        startWin.Checked = Setup.StartWithWindows;
        startWin.CheckedChanged += delegate { try { Setup.StartWithWindows = startWin.Checked; } catch (Exception ex) { MessageBox.Show(this, ex.Message, "AECopy"); } };
        Controls.Add(startWin);
        DragToggle = new Toggle("Drag & drop") { Location = new Point(20, 378), Width = 170 };
        DragToggle.Checked = Setup.GetFlag("DragDrop", true);
        tip.SetToolTip(DragToggle, "Drag a selection from one After Effects and drop it on another to paste it there");
        DragToggle.CheckedChanged += delegate { ctx.SetDragDrop(DragToggle.Checked); };
        Controls.Add(DragToggle);
        var about = new RoundButton("About", false) { Size = new Size(76, 28), Location = new Point(440 - 20 - 76 - 8 - 76, 378) };
        about.Click += delegate { using (var f = new AboutForm()) f.ShowDialog(this); };
        Controls.Add(about);
        var quit = new RoundButton("Quit", false) { Danger = true, Size = new Size(76, 28), Location = new Point(440 - 20 - 76, 378) };
        tip.SetToolTip(quit, "Stop AECopy in every After Effects and quit (it starts again with Windows or After Effects)");
        quit.Click += delegate { ctx.StopAndQuit(); };
        Controls.Add(quit);
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        // La croix range la fenetre ; Quit est dans le menu de l'icone.
        if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); return; }
        base.OnFormClosing(e);
    }

    public void ShowStatus(bool awake, bool enabled, List<AeInstance> aes)
    {
        if (!enabled) status.Set("Paused", Theme.Dim);
        else if (awake) status.Set("Active!", Theme.Green);
        else status.Set("Waiting", Theme.Dim);

        card.SetInstances(aes);
        int connected = 0;
        foreach (var a in aes) if (a.State == "connected") connected++;
        count.Text = aes.Count == 0 ? "" : connected + " of " + aes.Count + " connected";
        bool missing = connected < aes.Count;
        idleNoteColor = missing ? Theme.Orange : Theme.Dim;
        idleNote = missing
            ? "A window opened in an After Effects stops AECopy there: close it, then click Reload."
            : "Copy in one After Effects with Ctrl+C, paste in another with Ctrl+V.";
        if (!busy) { note.ForeColor = idleNoteColor; note.Text = idleNote; }
    }

    bool busy;
    string idleNote = "";
    Color idleNoteColor = Theme.Dim;

    // text null : fini, la note normale revient. value : -1 anime, 0..1 avancement.
    public void SetProgress(string text, float value)
    {
        busy = text != null;
        progress.Set(busy ? value : -2);
        note.ForeColor = busy ? Logo.Accent : idleNoteColor;
        note.Text = busy ? text : idleNote;
    }
}

// Etiquette qui suit le curseur pendant un glisser au-dessus d'un autre After Effects. Jamais active,
// ne prend pas les clics, decalee du curseur pour ne pas etre la fenetre sous la souris.
class DropTip : Form
{
    string text = "";

    public DropTip()
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        BackColor = Theme.Back;
        Opacity = 0.96;
        Size = new Size(260, 34);
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint, true);
    }

    protected override bool ShowWithoutActivation { get { return true; } }

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= 0x08000000 | 0x00000080 | 0x00000020; // NOACTIVATE | TOOLWINDOW | TRANSPARENT
            return cp;
        }
    }

    public void ShowAt(string t, int x, int y)
    {
        if (t != text)
        {
            text = t;
            Width = TextRenderer.MeasureText(text, Theme.Bold).Width + 46;
            Invalidate();
        }
        Location = new Point(x + 18, y + 22);
        if (!Visible) Show();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(Theme.Back);
        using (var path = Theme.Round(new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f), 8))
        {
            using (var b = new SolidBrush(Theme.Card)) g.FillPath(b, path);
            using (var p = new Pen(Logo.Accent, 1.5f)) g.DrawPath(p, path);
        }
        using (var logo = Logo.Draw(20)) g.DrawImage(logo, 8, (Height - 20) / 2);
        TextRenderer.DrawText(g, text, Theme.Bold, new Rectangle(34, 0, Width - 38, Height), Theme.Text, TextFormatFlags.VerticalCenter | TextFormatFlags.Left);
    }
}

class AboutForm : Form
{
    public AboutForm()
    {
        Text = "About AECopy";
        Icon = Logo.MakeIcon(32);
        Theme.DarkTitle(this);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false; MinimizeBox = false;
        StartPosition = FormStartPosition.CenterParent;
        ClientSize = new Size(380, 300);
        BackColor = Theme.Back; ForeColor = Theme.Text; Font = Theme.Body;
        var tip = new ToolTip();
        var logo = Theme.MakeLogo(72, tip);
        logo.Location = new Point(22, 22);
        Controls.Add(logo);
        Controls.Add(new Label { Text = "AECopy", Font = Theme.Title, AutoSize = true, Location = new Point(108, 26) });
        Controls.Add(new Label { Text = "Version " + Program.Version, ForeColor = Theme.Dim, AutoSize = true, Location = new Point(110, 58) });
        var by = new LinkLabel { Text = "Made by Ilhan Turan", AutoSize = true, Location = new Point(110, 78), LinkColor = Logo.Accent, ActiveLinkColor = Color.White, VisitedLinkColor = Logo.Accent, LinkBehavior = LinkBehavior.HoverUnderline };
        by.LinkArea = new LinkArea(8, 11);
        by.LinkClicked += delegate { Theme.OpenSite(); };
        Controls.Add(by);
        Controls.Add(new Panel { BackColor = Theme.Line, Location = new Point(22, 112), Size = new Size(336, 1) });
        Controls.Add(new Label
        {
            AutoSize = false, Location = new Point(22, 124), Size = new Size(336, 120), ForeColor = Theme.Text,
            Text = "Copy and paste layers, effects, keyframes and whole compositions between After Effects windows and versions (2020 to 2026) with Ctrl+C / Ctrl+V.\n\nCopy in one After Effects, paste in another: AECopy rebuilds what you copied, with its precomps, footage and settings."
        });
        var ok = new RoundButton("OK", true) { Size = new Size(84, 28), Location = new Point(274, 254) };
        ok.Click += delegate { Close(); };
        Controls.Add(ok);
    }
}

class AppContext : ApplicationContext
{
    readonly Relay relay = new Relay();
    readonly NotifyIcon tray = new NotifyIcon();
    readonly MainForm form;
    readonly System.Windows.Forms.Timer watch = new System.Windows.Forms.Timer();
    readonly EventWaitHandle showEvent;
    readonly EventWaitHandle quitEvent;
    List<AeInstance> instances = new List<AeInstance>();
    int idleTicks;
    // After Effects deja vus (deja ouverts au lancement d'AECopy, ou deja verifies apres leur demarrage)
    // et instant ou la fenetre de chaque nouveau est apparue.
    readonly HashSet<uint> seenAe = new HashSet<uint>();
    readonly Dictionary<uint, DateTime> aeReadySince = new Dictionary<uint, DateTime>();
    volatile bool scanning;

    public AppContext(bool showWindow)
    {
        Setup.FirstRun();
        // Exe deplace : le lancement avec Windows suit le nouvel emplacement.
        try { if (Setup.StartWithWindows) Setup.StartWithWindows = true; } catch { }
        var versions = Setup.InstallStartupScripts();
        Program.Log("startup script installed for After Effects " + string.Join(", ", versions.ToArray()));

        form = new MainForm(this);
        // Fenetre creee tout de suite, meme cachee : sans handle, BeginInvoke (affichage demande par une
        // deuxieme ouverture de l'exe, mise a jour de la liste) levait une exception et fermait l'appli.
        var handle = form.Handle;
        relay.Progress = delegate (string text, float value)
        {
            try { form.BeginInvoke((Action)delegate { form.SetProgress(text, value); }); } catch { }
        };
        relay.Notify = delegate (string text, bool error)
        {
            Program.Log("message: " + text);
            try { tray.ShowBalloonTip(5000, "AECopy", text, error ? ToolTipIcon.Warning : ToolTipIcon.Info); } catch { }
        };
        // Glisser-deposer : etiquette pres du curseur (les hooks tournent sur ce fil).
        dropTip = new DropTip();
        relay.ShowTip = delegate (string text, int x, int y) { dropTip.ShowAt(text, x, y); };
        relay.HideTip = delegate { dropTip.Hide(); };
        relay.DragEnabled = Setup.GetFlag("DragDrop", true);

        tray.Icon = Logo.MakeIcon(16);
        tray.Text = "AECopy";
        var menu = new ContextMenuStrip();
        menu.Items.Add("Open AECopy", null, delegate { ShowWindow(); });
        menu.Items.Add("Reload", null, delegate { if (form.ReloadButton.Enabled) ReloadAll(form.ReloadButton); });
        var enabledItem = new ToolStripMenuItem("Enabled") { Checked = true };
        enabledItem.Click += delegate { relay.Enabled = !relay.Enabled; enabledItem.Checked = relay.Enabled; Refresh(); };
        menu.Items.Add(enabledItem);
        dragItem = new ToolStripMenuItem("Drag && drop") { Checked = relay.DragEnabled };
        dragItem.Click += delegate { SetDragDrop(!relay.DragEnabled); };
        menu.Items.Add(dragItem);
        menu.Items.Add("Open log", null, delegate
        {
            string log = Path.Combine(Program.Root, "log.txt");
            try { Process.Start(File.Exists(log) ? log : Program.Root); } catch { }
        });
        menu.Items.Add("Clear cache", null, delegate
        {
            if (MessageBox.Show("Delete AECopy's logs and temporary files, as if it were new?\nWhat you copied will be forgotten; settings are kept.",
                "AECopy", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            int n = relay.ClearCache();
            Program.Log("cache cleared (" + n + " files)");
            relay.Notify("Cache cleared: " + n + " file(s) deleted.", false);
        });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Stop and quit", null, delegate { StopAndQuit(); });
        tray.ContextMenuStrip = menu;
        tray.DoubleClick += delegate { ShowWindow(); };
        tray.Visible = true;

        // Une deuxieme ouverture de l'exe affiche la fenetre de celui-ci.
        showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, Program.ShowEventName);
        var t = new Thread(delegate ()
        {
            while (true)
            {
                showEvent.WaitOne();
                try { form.BeginInvoke((Action)ShowWindow); } catch (Exception e) { Program.Log("show: " + e.Message); }
            }
        });
        t.IsBackground = true;
        t.Start();

        // AECopy.exe --quit (mise a jour, script) : arret propre de la copie en cours.
        // AECopy.exe --reload : comme le bouton Reload.
        var reloadEvent = new EventWaitHandle(false, EventResetMode.AutoReset, Program.ReloadEventName);
        var tr = new Thread(delegate ()
        {
            while (true)
            {
                reloadEvent.WaitOne();
                try { form.BeginInvoke((Action)delegate { if (form.ReloadButton.Enabled) ReloadAll(form.ReloadButton); }); } catch (Exception e) { Program.Log("reload: " + e.Message); }
            }
        });
        tr.IsBackground = true;
        tr.Start();

        quitEvent = new EventWaitHandle(false, EventResetMode.AutoReset, Program.QuitEventName);
        var tq = new Thread(delegate ()
        {
            quitEvent.WaitOne();
            try { form.BeginInvoke((Action)StopAndQuit); } catch (Exception e) { Program.Log("quit: " + e.Message); }
        });
        tq.IsBackground = true;
        tq.Start();

        watch.Interval = 2000;
        watch.Tick += delegate { Tick(); };
        watch.Start();
        foreach (var p in Process.GetProcessesByName("AfterFX")) using (p) seenAe.Add((uint)p.Id);
        Tick();
        if (showWindow) ShowWindow();
        // Au lancement : injection dans les After Effects deja ouverts dont le script n'est pas connecte.
        ThreadPool.QueueUserWorkItem(delegate
        {
            try
            {
                if (Process.GetProcessesByName("AfterFX").Length == 0) return;
                bool missing = false;
                foreach (var a in relay.Scan()) if (a.State != "connected") missing = true;
                if (missing) form.BeginInvoke((Action)delegate { if (form.ReloadButton.Enabled) ReloadAll(form.ReloadButton); });
            }
            catch (Exception e) { Program.Log("startup check: " + e.Message); }
        });
    }

    void ShowWindow()
    {
        form.Show();
        if (form.WindowState == FormWindowState.Minimized) form.WindowState = FormWindowState.Normal;
        form.Activate();
        Refresh();
    }

    // After Effects qui vient de demarrer : son script de demarrage l'a normalement connecte ; sinon
    // (accueil ou alerte au demarrage) une seule injection, jamais plus ensuite.
    void CheckNewAe(uint pid)
    {
        ThreadPool.QueueUserWorkItem(delegate
        {
            try
            {
                if (!relay.Enabled || relay.Ping(pid, 900)) return;
                string exe = "";
                using (var me = Process.GetProcessById((int)pid)) exe = me.MainModule.FileName;
                bool twin = false;
                foreach (var p in Process.GetProcessesByName("AfterFX"))
                    using (p) { try { if (p.Id != pid && p.MainModule.FileName == exe) twin = true; } catch { } }
                Program.Log("After Effects " + pid + " started without AECopy");
                if (!relay.Inject(pid, 15000, twin))
                    relay.Notify("AECopy could not connect to the After Effects that just started. Close any window open in it, then click Reload.", true);
            }
            catch (Exception e) { Program.Log("new After Effects: " + e.Message); }
        });
    }

    // Toutes les 2 s : reveil / veille selon les AfterFX ouverts, etat affiche.
    void Tick()
    {
        int n;
        var procs = Process.GetProcessesByName("AfterFX");
        n = procs.Length;
        var alive = new HashSet<uint>();
        foreach (var p in procs)
        {
            uint pid = (uint)p.Id;
            alive.Add(pid);
            if (!seenAe.Contains(pid))
            {
                string title = "";
                try { title = p.MainWindowTitle; } catch { }
                // Fenetre principale ouverte depuis 6 s : After Effects a fini de demarrer.
                if (title != "" && !aeReadySince.ContainsKey(pid)) aeReadySince[pid] = DateTime.Now;
                else if (title != "" && (DateTime.Now - aeReadySince[pid]).TotalSeconds >= 6)
                {
                    seenAe.Add(pid);
                    aeReadySince.Remove(pid);
                    CheckNewAe(pid);
                }
            }
            p.Dispose();
        }
        seenAe.IntersectWith(alive);
        if (n > 0) { idleTicks = 0; if (!relay.Awake) relay.Wake(); }
        else if (relay.Awake && ++idleTicks >= 10) relay.Sleep();
        tray.Text = relay.Awake ? "AECopy - active" : "AECopy - waiting for After Effects";

        if (scanning) return;
        if (form.Visible) Refresh();
    }


    void Refresh()
    {
        if (scanning) return;
        scanning = true;
        ThreadPool.QueueUserWorkItem(delegate
        {
            try
            {
                var list = relay.Scan();
                instances = list;
                form.BeginInvoke((Action)delegate { form.ShowStatus(relay.Awake, relay.Enabled, instances); });
            }
            catch (Exception e) { Program.Log("scan: " + e.Message); }
            finally { scanning = false; }
        });
    }

    // Bouton Inject d'une ligne : -r part vers l'After Effects de cette version actif le plus recemment ;
    // si deux fenetres de la meme version sont ouvertes, il faut d'abord cliquer dans la bonne.
    public void InjectOne(AeInstance ae, RoundButton button)
    {
        button.Enabled = false;
        button.Text = "...";
        relay.Progress("Injecting into After Effects " + ae.Version + "...", -1);
        ThreadPool.QueueUserWorkItem(delegate
        {
            bool ok = relay.Inject(ae.Pid, 12000, true);
            relay.Progress(null, -2);
            if (!ok) relay.Notify("Could not reach this After Effects. Close any dialog open in it, then Inject again, or restart it.", true);
            BackToFront();
            form.BeginInvoke((Action)Refresh);
        });
    }

    // Ramene la fenetre d'AECopy devant apres un passage par les After Effects.
    void BackToFront()
    {
        try { form.BeginInvoke((Action)delegate { if (form.Visible) Relay.Activate(form.Handle); }); } catch { }
    }

    DropTip dropTip;
    ToolStripMenuItem dragItem;

    // Interrupteur du glisser-deposer (fenetre et menu de l'icone restent d'accord).
    public void SetDragDrop(bool on)
    {
        relay.DragEnabled = on;
        Setup.SetFlag("DragDrop", on);
        if (dragItem != null && dragItem.Checked != on) dragItem.Checked = on;
        if (form != null && form.DragToggle != null && form.DragToggle.Checked != on) form.DragToggle.Checked = on;
        if (!on) dropTip.Hide();
    }

    // Reload : scripts de demarrage reinstalles, puis le script reinjecte dans chaque After Effects.
    // Connecte : rechargement par la boite aux lettres (sans changer de fenetre). Sinon : sa fenetre passe
    // au premier plan et le script y est injecte (-r part vers l'After Effects utilise en dernier).
    public void ReloadAll(RoundButton button)
    {
        button.Enabled = false;
        button.Text = "...";
        relay.Progress("Reloading...", 0);
        ThreadPool.QueueUserWorkItem(delegate
        {
            int ok = 0, n = 0;
            try
            {
                Setup.InstallStartupScripts();
                var list = relay.Scan();
                n = list.Count;
                for (int k = 0; k < list.Count; k++)
                {
                    var a = list[k];
                    relay.Progress("Reloading After Effects " + a.Version + " (" + (k + 1) + " of " + n + ")...", (k + 0.15f) / n);
                    bool done = false;
                    if (a.State == "connected" && relay.Send(a.Pid, "reload", 3000) != null)
                    {
                        for (int i = 0; i < 12 && !done; i++) { Thread.Sleep(500); done = relay.Ping(a.Pid, 800); }
                    }
                    if (!done) done = relay.Inject(a.Pid, 12000, true);
                    if (done) ok++;
                    relay.Progress("Reloading After Effects " + a.Version + " (" + (k + 1) + " of " + n + ")...", (k + 1f) / n);
                }
                Program.Log("reload: " + ok + "/" + n + " connected");
            }
            catch (Exception e) { Program.Log("reload: " + e.Message); }
            Thread.Sleep(300);
            relay.Progress(null, -2);
            if (n > 0) relay.Notify("Reloaded: " + ok + " of " + n + " After Effects connected.", ok < n);
            BackToFront();
            form.BeginInvoke((Action)delegate { button.Enabled = true; button.Text = "Reload"; Refresh(); });
        });
    }

    bool quitting;

    // Coupe le script dans chaque After Effects puis quitte. Les scripts de demarrage restent :
    // AECopy revient au prochain lancement de Windows ou d'After Effects.
    public void StopAndQuit()
    {
        if (quitting) return;
        quitting = true;
        watch.Stop();
        form.Hide();
        ThreadPool.QueueUserWorkItem(delegate
        {
            try { relay.StopAgents(); } catch (Exception e) { Program.Log("stop: " + e.Message); }
            Program.Log("stopped by the user");
            form.BeginInvoke((Action)ExitThread);
        });
    }

    public void Shutdown()
    {
        watch.Stop();
        relay.Stop();
        tray.Visible = false;
        tray.Dispose();
    }
}
