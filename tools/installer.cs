using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace StpSetup
{
    /* ---------------------------------------------------------------
       软件集合面板 —— 安装器 / 卸载器（同一源码，编译两份）
       · 带 payload.zip 资源编译  → 安装器（Setup）
       · 不带资源编译              → 卸载器（Uninstall.exe）
       命令行：
         安装器：/S 静默安装，--dir <路径> 指定目录
         卸载器：/S 静默卸载
       本文件由 csc.exe（.NET Framework 4.x）编译，仅使用 C# 5 语法。
       --------------------------------------------------------------- */

    static class AppInfo
    {
        public const string Name = "软件集合面板";
        public const string ExeName = "SoftwareToolsPanel.exe";
        public const string UninstExe = "Uninstall.exe";
        public const string PayloadRes = "payload";
        public const string RegPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\SoftwareToolsPanel";

        public static string Version
        {
            get { return Assembly.GetExecutingAssembly().GetName().Version.ToString(3); }
        }

        public static bool HasPayload()
        {
            foreach (string n in Assembly.GetExecutingAssembly().GetManifestResourceNames())
                if (n == PayloadRes || n.EndsWith("." + PayloadRes, StringComparison.Ordinal)) return true;
            return false;
        }

        public static string DefaultDir()
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs", "SoftwareToolsPanel");
        }

        public static string StartMenuDir()
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                @"Microsoft\Windows\Start Menu\Programs", "SoftwareToolsPanel");
        }

        public static string DesktopLnk()
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "SoftwareToolsPanel.lnk");
        }

        public static string InstalledReadme()
        {
            return string.Join("\r\n", new string[]
            {
                Name + "（已安装版）",
                "==========================",
                "",
                "· 配置、图标与皮肤设置保存在 %APPDATA%\\SoftwareToolsPanel。",
                "· 卸载方式：开始菜单「卸载 软件集合面板」，或 Windows 设置 → 应用。",
                "· 首次使用点右上角的扫描按钮（或「添加软件」里的「扫描开始菜单」），可一键把开始菜单里的程序加进来。",
                "· 也可以直接拖入 .exe / .lnk / .url / .bat 文件；右键卡片可编辑、移动分组或删除。",
                "",
                "快捷键",
                "  Ctrl+K            搜索",
                "  Ctrl+N            添加软件",
                "  Ctrl+,            皮肤与设置",
                "  Ctrl+Alt+Space    显示 / 隐藏面板"
            });
        }
    }

    /* ---------------------------------------------------------------
       入口
       --------------------------------------------------------------- */
    static class Program
    {
        [STAThread]
        static int Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool silent = false;
            string dirArg = null;
            bool uninstallArg = false;
            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                if (string.Equals(a, "/S", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(a, "--silent", StringComparison.OrdinalIgnoreCase))
                    silent = true;
                else if (string.Equals(a, "--uninstall", StringComparison.OrdinalIgnoreCase))
                    uninstallArg = true;
                else if (string.Equals(a, "--dir", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
                    dirArg = args[++i];
            }

            if (uninstallArg || !AppInfo.HasPayload())
                return RunUninstall(silent);

            string dir = !string.IsNullOrEmpty(dirArg) ? dirArg : AppInfo.DefaultDir();
            if (silent)
            {
                string err;
                bool ok = Installer.Install(dir, true, true, silent, null, out err);
                if (!ok) Console.Error.WriteLine(err);
                return ok ? 0 : 1;
            }
            Application.Run(new SetupForm(dir));
            return 0;
        }

        /* ------------------------- 卸载 ------------------------- */

        static int RunUninstall(bool silent)
        {
            // 已安装副本卸载：注册表位置以卸载器自身目录为准
            string dir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);

            if (!silent)
            {
                DialogResult r = MessageBox.Show(
                    "确定要卸载「" + AppInfo.Name + "」吗？\r\n\r\n安装目录：" + dir,
                    AppInfo.Name + " 卸载",
                    MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2);
                if (r != DialogResult.Yes) return 0;
            }

            // 需要先退出正在运行的程序
            var procs = Process.GetProcessesByName(Path.GetFileNameWithoutExtension(AppInfo.ExeName));
            if (procs.Length > 0)
            {
                if (!silent)
                {
                    DialogResult r = MessageBox.Show(
                        "检测到软件正在运行，卸载前需要退出它，是否继续？",
                        AppInfo.Name, MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
                    if (r != DialogResult.Yes) return 1;
                }
                foreach (var p in procs) { try { p.Kill(); p.WaitForExit(3000); } catch { } }
                Thread.Sleep(500);
            }

            Action<Action<int, string>> work = (report) =>
            {
                report(10, "删除快捷方式…");
                DeleteWithRetry(AppInfo.DesktopLnk(), false);
                DeleteWithRetry(AppInfo.StartMenuDir(), true);

                report(40, "清除注册表信息…");
                try { Registry.CurrentUser.DeleteSubKeyTree(AppInfo.RegPath, false); } catch { }

                report(60, "删除程序文件…");
                RemoveDir(dir);

                report(100, "完成");
            };

            if (silent)
            {
                work((p, s) => { });
                return 0;
            }

            using (var pf = new ProgressForm(AppInfo.Name + " 卸载"))
            {
                pf.Run(work);
            }
            MessageBox.Show("卸载完成。", AppInfo.Name, MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }

        // 删除失败（可能被资源管理器/索引短暂占用）时重试几次
        static void DeleteWithRetry(string path, bool isDir)
        {
            for (int i = 0; i < 4; i++)
            {
                try
                {
                    if (isDir)
                    {
                        if (!Directory.Exists(path)) return;
                        Directory.Delete(path, true);
                        if (Directory.Exists(path)) throw new IOException("目录仍存在");
                    }
                    else
                    {
                        if (!File.Exists(path)) return;
                        File.Delete(path);
                        if (File.Exists(path)) throw new IOException("文件仍存在");
                    }
                    return;
                }
                catch
                {
                    if (i == 3) Log("delete failed: " + path);
                    else Thread.Sleep(400);
                }
            }
        }

        static void Log(string msg)
        {
            try
            {
                File.AppendAllText(Path.Combine(Path.GetTempPath(), "stp-uninstall.log"),
                    DateTime.Now.ToString("HH:mm:ss.fff ") + msg + "\r\n");
            }
            catch { }
        }

        // 删除目录内容；卸载器自身在目录内时，延迟到进程退出后再清除整个目录
        static void RemoveDir(string dir)
        {
            string self = Path.GetFullPath(Application.ExecutablePath);
            string full = Path.GetFullPath(dir);
            if (!Directory.Exists(full)) return;

            foreach (string f in Directory.GetFiles(full, "*", SearchOption.AllDirectories))
            {
                try
                {
                    if (string.Equals(Path.GetFullPath(f), self, StringComparison.OrdinalIgnoreCase)) continue;
                    File.SetAttributes(f, FileAttributes.Normal);
                    File.Delete(f);
                }
                catch (Exception ex) { Log("del file EX " + f + ": " + ex.Message); }
            }
            foreach (string d in Directory.GetDirectories(full)) { try { Directory.Delete(d, true); } catch { } }

            // 卸载器自身仍在目录中：交给 cmd 延迟删除整个目录
            try
            {
                if (string.Equals(Path.GetDirectoryName(self), full, StringComparison.OrdinalIgnoreCase))
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = "cmd.exe",
                        Arguments = "/c ping -n 2 127.0.0.1 >nul & rd /s /q \"" + full + "\"",
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        WindowStyle = ProcessWindowStyle.Hidden
                    });
                }
                else if (Directory.Exists(full) && Directory.GetFileSystemEntries(full).Length == 0)
                {
                    Directory.Delete(full);
                }
            }
            catch { }
        }
    }

    /* ---------------------------------------------------------------
       安装逻辑（供 SetupForm 与静默安装调用）
       --------------------------------------------------------------- */
    static class Installer
    {
        public static bool Install(string targetDir, bool desktop, bool startMenu, bool silent,
                                   Action<long, long, string> progress, out string error)
        {
            error = null;
            try
            {
                string dir = Path.GetFullPath(targetDir);
                Directory.CreateDirectory(dir);

                long total, done = 0;
                Stream ps = Assembly.GetExecutingAssembly().GetManifestResourceStream(AppInfo.PayloadRes);
                if (ps == null) throw new Exception("安装包数据缺失（payload 未嵌入）");

                using (var zip = new ZipArchive(ps, ZipArchiveMode.Read))
                {
                    total = 0;
                    foreach (var e in zip.Entries) total += e.Length;
                    if (progress != null) progress(0, total, "正在解压文件…");

                    foreach (var e in zip.Entries)
                    {
                        string name = e.FullName.Replace('\\', '/');
                        while (name.StartsWith("./")) name = name.Substring(2);
                        if (name.Length == 0) continue;

                        string dest = Path.Combine(dir, name.Replace('/', Path.DirectorySeparatorChar));
                        string fullDest = Path.GetFullPath(dest);
                        string rootWithSep = dir.EndsWith(Path.DirectorySeparatorChar.ToString())
                            ? dir : dir + Path.DirectorySeparatorChar;
                        if (!fullDest.StartsWith(rootWithSep, StringComparison.OrdinalIgnoreCase))
                            throw new Exception("安装包包含非法路径：" + e.FullName);

                        if (name.EndsWith("/"))
                        {
                            Directory.CreateDirectory(fullDest);
                            continue;
                        }

                        Directory.CreateDirectory(Path.GetDirectoryName(fullDest));
                        using (var src = e.Open())
                        using (var outFs = new FileStream(fullDest, FileMode.Create, FileAccess.Write, FileShare.None))
                        {
                            byte[] buf = new byte[81920];
                            int read;
                            while ((read = src.Read(buf, 0, buf.Length)) > 0)
                            {
                                outFs.Write(buf, 0, read);
                                done += read;
                                if (progress != null) progress(done, total, "正在解压文件…");
                            }
                        }
                    }
                }

                // 免安装标记会让数据存到安装目录，已安装版应存 %APPDATA%
                try { File.Delete(Path.Combine(dir, "portable.dat")); } catch { }

                // 免安装版说明对已安装场景不适用，替换为安装版说明
                try { File.WriteAllText(Path.Combine(dir, "使用说明.txt"), AppInfo.InstalledReadme(),
                        new System.Text.UTF8Encoding(false)); } catch { }

                string exePath = Path.Combine(dir, AppInfo.ExeName);
                if (!File.Exists(exePath)) throw new Exception("安装包内容不完整，未找到主程序");

                if (progress != null) progress(0, 0, "写入卸载信息…");
                WriteUninstallInfo(dir, exePath, done);

                if (startMenu)
                {
                    if (progress != null) progress(0, 0, "创建开始菜单快捷方式…");
                    string smDir = AppInfo.StartMenuDir();
                    Directory.CreateDirectory(smDir);
                    MakeShortcut(Path.Combine(smDir, "SoftwareToolsPanel.lnk"), exePath, dir, exePath, AppInfo.Name);
                    string uninst = Path.Combine(dir, AppInfo.UninstExe);
                    if (File.Exists(uninst))
                        MakeShortcut(Path.Combine(smDir, "Uninstall SoftwareToolsPanel.lnk"),
                                     uninst, dir, uninst, "卸载 " + AppInfo.Name);
                }
                if (desktop)
                {
                    if (progress != null) progress(0, 0, "创建桌面快捷方式…");
                    MakeShortcut(AppInfo.DesktopLnk(), exePath, dir, exePath, AppInfo.Name);
                }

                if (progress != null) progress(total, total, "安装完成");
                return true;
            }
            catch (Exception ex)
            {
                error = ex.Message;
                return false;
            }
        }

        static void WriteUninstallInfo(string dir, string exePath, long bytes)
        {
            string uninstPath = Path.Combine(dir, AppInfo.UninstExe);
            using (var k = Registry.CurrentUser.CreateSubKey(AppInfo.RegPath))
            {
                if (k == null) throw new Exception("无法写入注册表");
                k.SetValue("DisplayName", AppInfo.Name);
                k.SetValue("DisplayVersion", AppInfo.Version);
                k.SetValue("Publisher", "SoftwareToolsPanel");
                k.SetValue("DisplayIcon", exePath);
                k.SetValue("InstallLocation", dir);
                k.SetValue("UninstallString", "\"" + uninstPath + "\"");
                k.SetValue("QuietUninstallString", "\"" + uninstPath + "\" /S");
                k.SetValue("EstimatedSize", (int)Math.Max(1, bytes / 1024), RegistryValueKind.DWord);
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
        }

        static void MakeShortcut(string lnkPath, string target, string workDir, string iconPath, string desc)
        {
            object shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
            dynamic sc = ((dynamic)shell).CreateShortcut(lnkPath);
            sc.TargetPath = target;
            sc.WorkingDirectory = workDir;
            sc.IconLocation = iconPath;
            sc.Description = desc;
            sc.Save();
        }
    }

    /* ---------------------------------------------------------------
       安装向导界面
       --------------------------------------------------------------- */
    class SetupForm : Form
    {
        readonly TextBox txtDir;
        readonly CheckBox chkDesktop;
        readonly CheckBox chkStart;
        readonly Button btnInstall;
        readonly Button btnCancel;
        readonly Button btnBrowse;
        readonly Panel bodyPanel;      // 安装页
        readonly Panel progressPanel;  // 进度页
        readonly Panel donePanel;      // 完成页
        readonly ProgressBar bar;
        readonly Label lblStatus;
        readonly CheckBox chkLaunch;
        volatile bool installing;

        static readonly Color Accent = Color.FromArgb(0x6c, 0x8c, 0xff);
        static readonly Color Dark = Color.FromArgb(0x15, 0x1a, 0x2e);
        static readonly Color TextMain = Color.FromArgb(0x27, 0x2b, 0x38);
        static readonly Color TextDim = Color.FromArgb(0x76, 0x7c, 0x8e);

        public SetupForm(string initialDir)
        {
            Text = AppInfo.Name + " 安装";
            ClientSize = new Size(500, 420);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.White;
            Font = new Font("Microsoft YaHei UI", 9F);

            /* 顶部标题栏 */
            var header = new Panel { Dock = DockStyle.Top, Height = 74, BackColor = Dark };
            var pic = new PictureBox { Left = 20, Top = 18, Width = 38, Height = 38, SizeMode = PictureBoxSizeMode.Zoom };
            try
            {
                string ico = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, AppInfo.ExeName);
                if (File.Exists(ico))
                {
                    using (var ic = Icon.ExtractAssociatedIcon(ico))
                        if (ic != null) pic.Image = ic.ToBitmap();
                }
            }
            catch { }
            var lblTitle = new Label
            {
                Left = 70, Top = 16, AutoSize = true, Text = AppInfo.Name,
                ForeColor = Color.White, Font = new Font(Font.FontFamily, 15F, FontStyle.Bold)
            };
            var lblSub = new Label
            {
                Left = 71, Top = 46, AutoSize = true, Text = "安装向导  ·  版本 " + AppInfo.Version,
                ForeColor = Color.FromArgb(0x9a, 0xa3, 0xc0), Font = new Font(Font.FontFamily, 8.5F)
            };
            header.Controls.Add(pic); header.Controls.Add(lblTitle); header.Controls.Add(lblSub);

            /* --- 安装页 --- */
            bodyPanel = new Panel { Left = 0, Top = 74, Width = 500, Height = 346 };

            var lblPos = new Label { Left = 24, Top = 24, AutoSize = true, Text = "安装位置：", ForeColor = TextMain };
            txtDir = new TextBox { Left = 24, Top = 46, Width = 380, Text = initialDir, Font = new Font(Font.FontFamily, 9F) };
            btnBrowse = new FlatBtn { Left = 412, Top = 44, Width = 64, Height = 27, Text = "浏览…" };

            chkDesktop = new CheckBox { Left = 24, Top = 84, AutoSize = true, Text = "创建桌面快捷方式", Checked = true, ForeColor = TextMain };
            chkStart = new CheckBox { Left = 170, Top = 84, AutoSize = true, Text = "创建开始菜单快捷方式", Checked = true, ForeColor = TextMain };

            var info = new TextBox
            {
                Left = 24, Top = 120, Width = 452, Height = 168, Multiline = true, ReadOnly = true,
                BorderStyle = BorderStyle.FixedSingle, BackColor = Color.FromArgb(0xf6, 0xf7, 0xfb),
                ForeColor = TextDim, ScrollBars = ScrollBars.Vertical,
                Text = string.Join("\r\n", new string[]
                {
                    "  收集、整理、一键启动你的软件（已安装 / 免安装均可）。",
                    "",
                    "  · 扫描开始菜单，一键导入已安装软件（自动分组）",
                    "  · 支持拖入 .exe / .lnk / .url / .bat 快速添加",
                    "  · 9 套皮肤、强调色、背景图、卡片尺寸随心调",
                    "  · 全局快捷键 Ctrl+Alt+Space 呼出 / 隐藏面板",
                    "",
                    "  · 配置保存在 %APPDATA%\\SoftwareToolsPanel",
                    "  · 卸载：开始菜单「卸载 软件集合面板」"
                })
            };

            btnInstall = new AccentBtn { Left = 284, Top = 302, Width = 96, Height = 34, Text = "安装" };
            btnCancel = new FlatBtn { Left = 388, Top = 302, Width = 88, Height = 34, Text = "取消" };

            bodyPanel.Controls.AddRange(new Control[] { lblPos, txtDir, btnBrowse, chkDesktop, chkStart, info, btnInstall, btnCancel });

            /* --- 进度页 --- */
            progressPanel = new Panel { Left = 0, Top = 74, Width = 500, Height = 346, Visible = false };
            var lblP = new Label
            {
                Left = 24, Top = 40, AutoSize = true, Text = "正在安装，请稍候…",
                ForeColor = TextMain, Font = new Font(Font.FontFamily, 12F, FontStyle.Bold)
            };
            bar = new ProgressBar { Left = 24, Top = 84, Width = 452, Height = 24, Style = ProgressBarStyle.Continuous };
            lblStatus = new Label { Left = 24, Top = 122, AutoSize = true, Text = "", ForeColor = TextDim };
            progressPanel.Controls.AddRange(new Control[] { lblP, bar, lblStatus });

            /* --- 完成页 --- */
            donePanel = new Panel { Left = 0, Top = 74, Width = 500, Height = 346, Visible = false };
            var okIcon = new PictureBox { Left = 24, Top = 34, Width = 44, Height = 44, SizeMode = PictureBoxSizeMode.CenterImage };
            okIcon.Image = SystemIcons.Information.ToBitmap();
            var lblDone = new Label
            {
                Left = 80, Top = 40, AutoSize = true, Text = "安装完成！",
                ForeColor = TextMain, Font = new Font(Font.FontFamily, 14F, FontStyle.Bold)
            };
            var lblDone2 = new Label
            {
                Left = 81, Top = 70, AutoSize = true, Text = "「" + AppInfo.Name + "」已成功安装到：" + txtDir.Text,
                ForeColor = TextDim
            };
            chkLaunch = new CheckBox { Left = 24, Top = 120, AutoSize = true, Text = "立即运行 " + AppInfo.Name, Checked = true, ForeColor = TextMain };
            var btnFinish = new AccentBtn { Left = 380, Top = 302, Width = 96, Height = 34, Text = "完成" };
            donePanel.Controls.AddRange(new Control[] { okIcon, lblDone, lblDone2, chkLaunch, btnFinish });

            Controls.Add(bodyPanel);
            Controls.Add(progressPanel);
            Controls.Add(donePanel);
            Controls.Add(header);

            btnBrowse.Click += (s, e) =>
            {
                using (var d = new FolderBrowserDialog())
                {
                    d.Description = "选择安装目录";
                    d.SelectedPath = txtDir.Text;
                    if (d.ShowDialog(this) == DialogResult.OK) txtDir.Text = d.SelectedPath;
                }
            };
            btnInstall.Click += OnInstall;
            btnCancel.Click += (s, e) => { if (!installing) Close(); };
            btnFinish.Click += (s, e) =>
            {
                if (chkLaunch.Checked)
                {
                    try
                    {
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = Path.Combine(txtDir.Text, AppInfo.ExeName),
                            WorkingDirectory = txtDir.Text,
                            UseShellExecute = true
                        });
                    }
                    catch { }
                }
                Close();
            };
            FormClosing += (s, e) => { if (installing) e.Cancel = true; };
        }

        void OnInstall(object sender, EventArgs e)
        {
            string dir = txtDir.Text.Trim();
            if (dir.Length == 0) { MessageBox.Show(this, "请选择安装目录。", AppInfo.Name); return; }
            try { Directory.CreateDirectory(dir); }
            catch (Exception ex)
            {
                MessageBox.Show(this, "无法创建安装目录：\r\n" + ex.Message, AppInfo.Name,
                                MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            bool desk = chkDesktop.Checked, start = chkStart.Checked;
            string target = dir;
            installing = true;
            bodyPanel.Visible = false;
            progressPanel.Visible = true;
            btnCancel.Enabled = false;

            var th = new Thread(() =>
            {
                string err;
                bool ok = Installer.Install(target, desk, start, false, SetProgress, out err);
                BeginInvoke((Action)(() =>
                {
                    installing = false;
                    if (ok)
                    {
                        progressPanel.Visible = false;
                        donePanel.Visible = true;
                        foreach (Control c in donePanel.Controls)
                            if (c is Label && ((Label)c).Text.StartsWith("「"))
                                ((Label)c).Text = "「" + AppInfo.Name + "」已成功安装到：" + target;
                    }
                    else
                    {
                        progressPanel.Visible = false;
                        bodyPanel.Visible = true;
                        btnCancel.Enabled = true;
                        MessageBox.Show(this, "安装失败：\r\n" + err, AppInfo.Name,
                                        MessageBoxButtons.OK, MessageBoxIcon.Error);
                    }
                }));
            });
            th.IsBackground = true;
            th.Start();
        }

        void SetProgress(long done, long total, string status)
        {
            if (IsDisposed) return;
            try
            {
                BeginInvoke((Action)(() =>
                {
                    if (total > 0)
                    {
                        int p = (int)Math.Min(100, done * 100 / total);
                        bar.Value = Math.Max(bar.Value, p);
                    }
                    if (lblStatus.Text != status) lblStatus.Text = status;
                }));
            }
            catch { }
        }
    }

    /* ---------------------------------------------------------------
       卸载进度小窗
       --------------------------------------------------------------- */
    class ProgressForm : Form
    {
        readonly ProgressBar bar;
        readonly Label lbl;
        readonly string title;

        public ProgressForm(string title)
        {
            this.title = title;
            ClientSize = new Size(400, 130);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.White;
            Font = new Font("Microsoft YaHei UI", 9F);
            Text = title;

            lbl = new Label { Left = 20, Top = 20, AutoSize = true, Text = "正在卸载…", ForeColor = Color.FromArgb(0x27, 0x2b, 0x38) };
            bar = new ProgressBar { Left = 20, Top = 50, Width = 360, Height = 22, Style = ProgressBarStyle.Continuous };
            Controls.Add(lbl);
            Controls.Add(bar);
        }

        public void Run(Action<Action<int, string>> work)
        {
            Show();
            Update();
            var done = false;
            Exception error = null;
            var th = new Thread(() =>
            {
                try { work((p, s) => BeginInvoke((Action)(() => { bar.Value = Math.Min(100, p); lbl.Text = s; }))); }
                catch (Exception ex) { error = ex; }
                finally { done = true; try { BeginInvoke((Action)(() => Close())); } catch { } }
            });
            th.IsBackground = true;
            th.Start();
            while (!done) Application.DoEvents();
            if (error != null)
                MessageBox.Show(this, "卸载过程出错：\r\n" + error.Message, title,
                                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    /* ---------------------------------------------------------------
       按钮样式
       --------------------------------------------------------------- */
    class FlatBtn : Button
    {
        public FlatBtn()
        {
            FlatStyle = FlatStyle.Flat;
            FlatAppearance.BorderColor = Color.FromArgb(0xd4, 0xd8, 0xe4);
            FlatAppearance.BorderSize = 1;
            FlatAppearance.MouseOverBackColor = Color.FromArgb(0xf0, 0xf3, 0xfa);
            ForeColor = Color.FromArgb(0x3a, 0x40, 0x54);
            Cursor = Cursors.Hand;
        }
    }

    class AccentBtn : Button
    {
        public AccentBtn()
        {
            FlatStyle = FlatStyle.Flat;
            FlatAppearance.BorderSize = 0;
            FlatAppearance.MouseOverBackColor = Color.FromArgb(0x59, 0x7b, 0xf0);
            BackColor = Color.FromArgb(0x6c, 0x8c, 0xff);
            ForeColor = Color.White;
            Cursor = Cursors.Hand;
            Font = new Font(Font.FontFamily, 9.5F, FontStyle.Bold);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            using (var p = new GraphicsPath())
            {
                int r = 8;
                p.AddArc(0, 0, r * 2, r * 2, 180, 90);
                p.AddArc(Width - r * 2, 0, r * 2, r * 2, 270, 90);
                p.AddArc(Width - r * 2, Height - r * 2, r * 2, r * 2, 0, 90);
                p.AddArc(0, Height - r * 2, r * 2, r * 2, 90, 90);
                p.CloseFigure();
                Region = new Region(p);
            }
        }
    }
}
