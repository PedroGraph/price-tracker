// Price Tracker installer: a small hand-made window around the silent app installer.
// Downloads the latest release from GitHub, checks its SHA-512 against latest.yml,
// runs it silently and opens the app. Built with the C# compiler that ships with
// Windows (C# 5, .NET Framework 4.8): see scripts/build-installer.cjs.
using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;
using Microsoft.Win32;

[assembly: AssemblyTitle("Price Tracker Installer")]
[assembly: AssemblyProduct("Price Tracker")]
[assembly: AssemblyVersion("1.0.0.0")]

namespace PriceTrackerInstaller
{
    public class Program
    {
        [STAThread]
        public static void Main()
        {
            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; // TLS 1.2
            var app = new Application();
            var args = Environment.GetCommandLineArgs();
            // Development aid: `--snapshot <file.png> <welcome|progress|done|error>` renders one page to an image and exits.
            int i = Array.IndexOf(args, "--snapshot");
            if (i > 0 && args.Length > i + 2)
            {
                var w = new InstallerWindow(args[i + 2]);
                w.Loaded += async delegate
                {
                    await Task.Delay(2200);
                    w.SaveSnapshot(args[i + 1]);
                    app.Shutdown();
                };
                app.Run(w);
                return;
            }
            app.Run(new InstallerWindow(null));
        }
    }

    static class Theme
    {
        public static readonly Color Bg = Rgb(0x12, 0x14, 0x12);
        public static readonly Color Panel = Rgb(0x1a, 0x1d, 0x1b);
        public static readonly Color Line = Rgb(0x2d, 0x32, 0x2f);
        public static readonly Color Text = Rgb(0xec, 0xeb, 0xe6);
        public static readonly Color Muted = Rgb(0xa0, 0x9e, 0x97);
        public static readonly Color Faint = Rgb(0x6f, 0x6d, 0x67);
        public static readonly Color Teal = Rgb(0x0e, 0x8a, 0x7b);
        public static readonly Color TealLight = Rgb(0x3c, 0xb8, 0xa5);
        public static readonly Color Red = Rgb(0xf0, 0x6b, 0x60);
        public static readonly FontFamily Sans = new FontFamily("Segoe UI Variable Display, Segoe UI");
        public static readonly FontFamily Mono = new FontFamily("Cascadia Mono, Consolas");

        public static Color Rgb(byte r, byte g, byte b) { return Color.FromRgb(r, g, b); }
        public static SolidColorBrush Brush(Color c) { return new SolidColorBrush(c); }
        public static SolidColorBrush Brush(Color c, double opacity) { var b = new SolidColorBrush(c); b.Opacity = opacity; return b; }
    }

    /// Spanish when Windows is in Spanish, English otherwise.
    static class T
    {
        static readonly bool Es = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "es";
        public static string S(string en, string es) { return Es ? es : en; }
    }

    class Release
    {
        public string Version;
        public string File;
        public string Sha512;
        public long Size;
    }

    public class InstallerWindow : Window
    {
        const string Repo = "https://github.com/PedroGraph/price-tracker/releases/latest/download/";

        readonly Grid pages = new Grid();
        readonly TextBlock versionLine = new TextBlock();
        Release release;

        // progress page
        readonly Border barFill = new Border();
        readonly TextBlock progressTitle = new TextBlock();
        readonly TextBlock progressDetail = new TextBlock();
        readonly StepRow stepDownload = new StepRow(T.S("Download", "Descargar"));
        readonly StepRow stepVerify = new StepRow(T.S("Verify", "Verificar"));
        readonly StepRow stepInstall = new StepRow(T.S("Install", "Instalar"));
        readonly TextBlock errorText = new TextBlock();

        readonly string previewPage;

        public InstallerWindow(string previewPage)
        {
            this.previewPage = previewPage;
            Title = "Price Tracker";
            Width = 800; Height = 520;
            WindowStyle = WindowStyle.None;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            ResizeMode = ResizeMode.NoResize;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            var ico = LoadImage("icon.png");
            if (ico != null) Icon = ico;

            // The rounded card, with room around it for the shadow.
            var card = new Border
            {
                Margin = new Thickness(20),
                CornerRadius = new CornerRadius(20),
                Background = Theme.Brush(Theme.Bg),
                BorderBrush = Theme.Brush(Theme.Line),
                BorderThickness = new Thickness(1),
                Effect = new DropShadowEffect { BlurRadius = 24, ShadowDepth = 4, Opacity = 0.35, Color = Colors.Black },
                ClipToBounds = true
            };
            card.MouseLeftButtonDown += delegate(object s, MouseButtonEventArgs e) { if (e.ButtonState == MouseButtonState.Pressed) DragMove(); };
            Content = card;

            var layout = new Grid();
            // ClipToBounds ignores rounded corners, so clip to the card's shape explicitly.
            layout.SizeChanged += delegate
            {
                layout.Clip = new RectangleGeometry(new Rect(0, 0, layout.ActualWidth, layout.ActualHeight), 19, 19);
            };
            layout.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(290) });
            layout.ColumnDefinitions.Add(new ColumnDefinition());
            card.Child = layout;

            var art = BuildArt();
            Grid.SetColumn(art, 0);
            layout.Children.Add(art);

            var right = new Grid { Margin = new Thickness(40, 34, 36, 30) };
            Grid.SetColumn(right, 1);
            layout.Children.Add(right);
            right.Children.Add(pages);

            var close = new TextBlock
            {
                Text = "✕", FontSize = 14, Foreground = Theme.Brush(Theme.Muted),
                HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(0, -18, -18, 0), Cursor = Cursors.Hand, Padding = new Thickness(6)
            };
            close.MouseLeftButtonDown += delegate(object s, MouseButtonEventArgs e) { e.Handled = true; };
            close.MouseLeftButtonUp += delegate { Close(); };
            close.MouseEnter += delegate { close.Foreground = Theme.Brush(Theme.Text); };
            close.MouseLeave += delegate { close.Foreground = Theme.Brush(Theme.Muted); };
            right.Children.Add(close);

            if (previewPage == null)
            {
                ShowPage(BuildWelcome());
                Loaded += async delegate { await LoadRelease(); };
                return;
            }
            // Sample states for --snapshot.
            if (previewPage == "progress")
            {
                ShowPage(BuildProgress());
                progressDetail.Text = "58 / 99 MB";
                stepDownload.Active();
                Loaded += delegate { SetProgress(0.47); };
            }
            else if (previewPage == "done") ShowPage(BuildDone());
            else if (previewPage == "error") ShowPage(BuildError(T.S("Couldn't download from GitHub.", "No se pudo descargar desde GitHub.")));
            else { ShowPage(BuildWelcome()); versionLine.Text = T.S("Version ", "Versión ") + "1.2.2  ·  99 MB" + Environment.NewLine + T.S("just for you, no admin rights", "solo para tu usuario, sin permisos de administrador"); }
        }

        public void SaveSnapshot(string path)
        {
            var element = (FrameworkElement)Content;
            var bmp = new RenderTargetBitmap((int)ActualWidth, (int)ActualHeight, 96, 96, PixelFormats.Pbgra32);
            bmp.Render(element);
            var enc = new PngBitmapEncoder();
            enc.Frames.Add(BitmapFrame.Create(bmp));
            using (var f = File.Create(path)) enc.Save(f);
        }

        // ---------- left panel: brand art ----------

        UIElement BuildArt()
        {
            var g = new Grid { ClipToBounds = true };
            g.Background = new LinearGradientBrush(Theme.Teal, Theme.TealLight, new Point(0, 0), new Point(1, 1));

            // A price line that draws itself and drops at the end: what the app is about.
            var canvas = new Canvas { Width = 290, Height = 480, VerticalAlignment = VerticalAlignment.Bottom };
            var pts = new PointCollection(new[] {
                new Point(-10, 330), new Point(40, 318), new Point(80, 336), new Point(120, 300),
                new Point(160, 322), new Point(200, 292), new Point(236, 316), new Point(262, 372), new Point(300, 384) });
            var line = new Polyline
            {
                Points = pts, Stroke = Theme.Brush(Colors.White, 0.55), StrokeThickness = 3,
                StrokeLineJoin = PenLineJoin.Round, StrokeDashArray = new DoubleCollection(new[] { 200.0, 200.0 }),
                StrokeDashOffset = 200
            };
            canvas.Children.Add(line);
            var dot = new Ellipse { Width = 12, Height = 12, Fill = Brushes.White, Opacity = 0 };
            Canvas.SetLeft(dot, 256); Canvas.SetTop(dot, 366);
            canvas.Children.Add(dot);
            var area = new Polygon
            {
                Points = new PointCollection(pts) { new Point(300, 480), new Point(-10, 480) },
                Fill = new LinearGradientBrush(Color.FromArgb(0x40, 255, 255, 255), Color.FromArgb(0, 255, 255, 255), 90)
            };
            canvas.Children.Insert(0, area);
            g.Children.Add(canvas);
            Loaded += delegate
            {
                line.BeginAnimation(Shape.StrokeDashOffsetProperty,
                    new DoubleAnimation(200, 0, TimeSpan.FromSeconds(1.6)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } });
                dot.BeginAnimation(OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromSeconds(0.4)) { BeginTime = TimeSpan.FromSeconds(1.4) });
            };

            var brand = new StackPanel { Margin = new Thickness(34, 40, 30, 0) };
            var logo = LoadImage("icon.png");
            if (logo != null)
            {
                brand.Children.Add(new Border
                {
                    Width = 64, Height = 64, CornerRadius = new CornerRadius(16), HorizontalAlignment = HorizontalAlignment.Left,
                    Background = Theme.Brush(Colors.White, 0.16), Padding = new Thickness(8),
                    Child = new Image { Source = logo }
                });
            }
            brand.Children.Add(Label("Price Tracker", 28, FontWeights.Bold, Colors.White, new Thickness(0, 22, 0, 6)));
            var tag = Label(T.S("Follow the prices in your Amazon cart and hear about it when they drop.",
                                "Sigue los precios de tu carrito de Amazon y entérate cuando bajen."), 15, FontWeights.Normal, Colors.White, new Thickness(0));
            tag.Opacity = 0.85;
            brand.Children.Add(tag);
            g.Children.Add(brand);
            return g;
        }

        // ---------- pages ----------

        UIElement BuildWelcome()
        {
            var p = new DockPanel { LastChildFill = false };
            var top = new StackPanel();
            DockPanel.SetDock(top, Dock.Top);
            top.Children.Add(Label(T.S("Install Price Tracker", "Instala Price Tracker"), 26, FontWeights.Bold, Theme.Text, new Thickness(0, 6, 0, 8)));
            top.Children.Add(Label(T.S("Everything you need, made to measure.", "Todo lo que necesitas, hecho a la medida."), 15, FontWeights.Normal, Theme.Muted, new Thickness(0, 0, 0, 26)));
            top.Children.Add(Feature("↗", T.S("Your cart, lists and every seller", "Tu carrito, listas y todos los vendedores"),
                T.S("Price history and a good-time-to-buy indicator.", "Historial de precios e indicador de buen momento para comprar.")));
            top.Children.Add(Feature("✉", T.S("Alerts by email and Telegram", "Alertas por email y Telegram"),
                T.S("When it drops, hits your target or comes back.", "Cuando baja, llega a tu objetivo o vuelve a stock.")));
            top.Children.Add(Feature("⚿", T.S("Your data stays on your PC", "Tus datos se quedan en tu PC"),
                T.S("Encrypted session and keys. No accounts, no servers.", "Sesión y claves cifradas. Sin cuentas ni servidores.")));
            p.Children.Add(top);

            var bottom = new StackPanel();
            DockPanel.SetDock(bottom, Dock.Bottom);
            versionLine.Text = T.S("Looking for the latest version…", "Buscando la última versión…");
            versionLine.FontFamily = Theme.Mono; versionLine.FontSize = 12; versionLine.Foreground = Theme.Brush(Theme.Faint);
            versionLine.Margin = new Thickness(0, 0, 0, 14);
            versionLine.TextWrapping = TextWrapping.Wrap;
            versionLine.LineHeight = 18;
            bottom.Children.Add(versionLine);
            var buttons = new StackPanel { Orientation = Orientation.Horizontal };
            buttons.Children.Add(Button(T.S("Install", "Instalar"), true, delegate { Install(); }));
            buttons.Children.Add(Button(T.S("Cancel", "Cancelar"), false, delegate { Close(); }));
            bottom.Children.Add(buttons);
            p.Children.Add(bottom);
            return p;
        }

        UIElement BuildProgress()
        {
            var p = new StackPanel();
            progressTitle.Text = T.S("Installing…", "Instalando…");
            StyleText(progressTitle, 26, FontWeights.Bold, Theme.Text, new Thickness(0, 6, 0, 8));
            p.Children.Add(progressTitle);
            StyleText(progressDetail, 14, FontWeights.Normal, Theme.Muted, new Thickness(0, 0, 0, 28));
            progressDetail.FontFamily = Theme.Mono;
            p.Children.Add(progressDetail);

            var track = new Border { Height = 10, CornerRadius = new CornerRadius(5), Background = Theme.Brush(Theme.Line) };
            barFill.HorizontalAlignment = HorizontalAlignment.Left;
            barFill.CornerRadius = new CornerRadius(5);
            barFill.Width = 0;
            barFill.Background = new LinearGradientBrush(Theme.Teal, Theme.TealLight, 0);
            track.Child = barFill;
            p.Children.Add(track);

            var steps = new StackPanel { Margin = new Thickness(0, 30, 0, 0) };
            steps.Children.Add(stepDownload);
            steps.Children.Add(stepVerify);
            steps.Children.Add(stepInstall);
            p.Children.Add(steps);
            return p;
        }

        UIElement BuildDone()
        {
            var p = new DockPanel { LastChildFill = false };
            var top = new StackPanel();
            DockPanel.SetDock(top, Dock.Top);
            var check = new Border
            {
                Width = 64, Height = 64, CornerRadius = new CornerRadius(32), HorizontalAlignment = HorizontalAlignment.Left,
                Background = Theme.Brush(Theme.Teal, 0.18), Margin = new Thickness(0, 10, 0, 22),
                RenderTransformOrigin = new Point(0.5, 0.5), RenderTransform = new ScaleTransform(0.6, 0.6),
                Child = new TextBlock { Text = "✓", FontSize = 30, FontWeight = FontWeights.Bold, Foreground = Theme.Brush(Theme.TealLight),
                    HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center }
            };
            var pop = new DoubleAnimation(0.6, 1, TimeSpan.FromMilliseconds(420)) { EasingFunction = new BackEase { Amplitude = 0.5, EasingMode = EasingMode.EaseOut } };
            check.Loaded += delegate
            {
                ((ScaleTransform)check.RenderTransform).BeginAnimation(ScaleTransform.ScaleXProperty, pop);
                ((ScaleTransform)check.RenderTransform).BeginAnimation(ScaleTransform.ScaleYProperty, pop);
            };
            top.Children.Add(check);
            top.Children.Add(Label(T.S("All set", "Todo listo"), 26, FontWeights.Bold, Theme.Text, new Thickness(0, 0, 0, 8)));
            top.Children.Add(Label(T.S("Price Tracker is installed. You'll find it in the Start menu and on your desktop; it keeps running in the tray next to the clock.",
                                       "Price Tracker quedó instalada. La encuentras en el menú Inicio y en tu escritorio; sigue trabajando en la bandeja junto al reloj."),
                                   15, FontWeights.Normal, Theme.Muted, new Thickness(0)));
            p.Children.Add(top);

            var buttons = new StackPanel { Orientation = Orientation.Horizontal };
            DockPanel.SetDock(buttons, Dock.Bottom);
            buttons.Children.Add(Button(T.S("Open Price Tracker", "Abrir Price Tracker"), true, delegate { LaunchApp(); Close(); }));
            buttons.Children.Add(Button(T.S("Close", "Cerrar"), false, delegate { Close(); }));
            p.Children.Add(buttons);
            return p;
        }

        UIElement BuildError(string message)
        {
            var p = new DockPanel { LastChildFill = false };
            var top = new StackPanel();
            DockPanel.SetDock(top, Dock.Top);
            top.Children.Add(Label(T.S("Something went wrong", "Algo salió mal"), 26, FontWeights.Bold, Theme.Text, new Thickness(0, 6, 0, 10)));
            StyleText(errorText, 14, FontWeights.Normal, Theme.Red, new Thickness(0, 0, 0, 12));
            errorText.Text = message;
            top.Children.Add(errorText);
            top.Children.Add(Label(T.S("Check your internet connection and try again. Nothing was changed on your PC.",
                                       "Revisa tu conexión a internet e inténtalo de nuevo. No se cambió nada en tu PC."),
                                   14, FontWeights.Normal, Theme.Muted, new Thickness(0)));
            p.Children.Add(top);
            var buttons = new StackPanel { Orientation = Orientation.Horizontal };
            DockPanel.SetDock(buttons, Dock.Bottom);
            buttons.Children.Add(Button(T.S("Try again", "Reintentar"), true, delegate { Install(); }));
            buttons.Children.Add(Button(T.S("Close", "Cerrar"), false, delegate { Close(); }));
            p.Children.Add(buttons);
            return p;
        }

        void ShowPage(UIElement page)
        {
            pages.Children.Clear();
            page.Opacity = 0;
            page.RenderTransform = new TranslateTransform(0, 8);
            pages.Children.Add(page);
            page.BeginAnimation(OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(260)));
            ((TranslateTransform)page.RenderTransform).BeginAnimation(TranslateTransform.YProperty,
                new DoubleAnimation(8, 0, TimeSpan.FromMilliseconds(260)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } });
        }

        // ---------- work ----------

        async Task LoadRelease()
        {
            try
            {
                string yml;
                using (var wc = new WebClient()) yml = await wc.DownloadStringTaskAsync(Repo + "latest.yml");
                release = ParseLatest(yml);
                versionLine.Text = T.S("Version ", "Versión ") + release.Version + "  ·  " + (release.Size / 1048576) + " MB" + Environment.NewLine +
                                   T.S("just for you, no admin rights", "solo para tu usuario, sin permisos de administrador");
            }
            catch (Exception)
            {
                versionLine.Text = T.S("Couldn't reach GitHub yet. Installing will try again.", "Aún no se pudo contactar a GitHub. Al instalar se intentará de nuevo.");
            }
        }

        static Release ParseLatest(string yml)
        {
            // Top-level keys of electron-builder's latest.yml.
            var version = Regex.Match(yml, @"^version:\s*(\S+)", RegexOptions.Multiline).Groups[1].Value;
            var path = Regex.Match(yml, @"^path:\s*(\S+)", RegexOptions.Multiline).Groups[1].Value;
            var sha = Regex.Match(yml, @"^sha512:\s*(\S+)", RegexOptions.Multiline).Groups[1].Value;
            var size = Regex.Match(yml, @"^\s+size:\s*(\d+)", RegexOptions.Multiline).Groups[1].Value;
            // Only a plain file name from our own release: no paths, no other hosts.
            if (!Regex.IsMatch(path, @"^[A-Za-z0-9._-]+\.exe$") || sha.Length < 80 || version.Length == 0)
                throw new InvalidDataException(T.S("The release information looks wrong.", "La información de la versión no es válida."));
            return new Release { Version = version, File = path, Sha512 = sha, Size = size.Length > 0 ? long.Parse(size) : 0 };
        }

        async void Install()
        {
            ShowPage(BuildProgress());
            stepDownload.Reset(); stepVerify.Reset(); stepInstall.Reset();
            string file = null;
            try
            {
                if (release == null)
                {
                    using (var wc = new WebClient()) release = ParseLatest(await wc.DownloadStringTaskAsync(Repo + "latest.yml"));
                }

                // 1. Download
                stepDownload.Active();
                file = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "PriceTracker-" + Guid.NewGuid().ToString("N") + ".exe");
                using (var wc = new WebClient())
                {
                    wc.DownloadProgressChanged += delegate(object s, DownloadProgressChangedEventArgs e)
                    {
                        var total = e.TotalBytesToReceive > 0 ? e.TotalBytesToReceive : release.Size;
                        var pct = total > 0 ? (double)e.BytesReceived / total : 0;
                        SetProgress(pct * 0.8);
                        progressDetail.Text = (e.BytesReceived / 1048576) + " / " + (total / 1048576) + " MB";
                    };
                    await wc.DownloadFileTaskAsync(new Uri(Repo + release.File), file);
                }
                stepDownload.Done();

                // 2. Verify: the file must match the SHA-512 published with the release.
                stepVerify.Active();
                progressDetail.Text = T.S("Checking the file's fingerprint (SHA-512)…", "Comprobando la huella del archivo (SHA-512)…");
                var hash = await Task.Run(() => Sha512(file));
                if (hash != release.Sha512)
                    throw new InvalidDataException(T.S("The download doesn't match the published fingerprint. It was deleted for safety.",
                                                       "La descarga no coincide con la huella publicada. Se borró por seguridad."));
                SetProgress(0.85);
                stepVerify.Done();

                // 3. Install silently (per user, no admin rights).
                stepInstall.Active();
                progressDetail.Text = T.S("Installing ", "Instalando ") + release.Version + "…";
                var proc = Process.Start(new ProcessStartInfo(file, "/S") { UseShellExecute = false });
                await Task.Run(() => proc.WaitForExit());
                if (proc.ExitCode != 0)
                    throw new Exception(T.S("The installer stopped with code ", "El instalador terminó con el código ") + proc.ExitCode + ".");
                SetProgress(1);
                stepInstall.Done();
                await Task.Delay(500);
                ShowPage(BuildDone());
            }
            catch (Exception ex)
            {
                ShowPage(BuildError(ex is WebException ? T.S("Couldn't download from GitHub.", "No se pudo descargar desde GitHub.") : ex.Message));
            }
            finally
            {
                if (file != null) try { File.Delete(file); } catch { }
            }
        }

        static string Sha512(string path)
        {
            using (var s = File.OpenRead(path))
            using (var sha = SHA512.Create()) return Convert.ToBase64String(sha.ComputeHash(s));
        }

        void SetProgress(double fraction)
        {
            var track = (Border)barFill.Parent;
            var width = Math.Max(0, Math.Min(1, fraction)) * track.ActualWidth;
            barFill.BeginAnimation(WidthProperty, new DoubleAnimation(width, TimeSpan.FromMilliseconds(250)));
        }

        /// The app's exe, from the uninstall entry the installer writes for this user.
        static void LaunchApp()
        {
            try
            {
                using (var root = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall"))
                {
                    if (root == null) return;
                    foreach (var name in root.GetSubKeyNames())
                    {
                        using (var k = root.OpenSubKey(name))
                        {
                            if (k == null || (k.GetValue("DisplayName") as string ?? "").IndexOf("Price Tracker", StringComparison.OrdinalIgnoreCase) < 0) continue;
                            var loc = k.GetValue("InstallLocation") as string;
                            if (string.IsNullOrEmpty(loc)) continue;
                            var exe = System.IO.Path.Combine(loc, "Price Tracker.exe");
                            if (File.Exists(exe)) { Process.Start(exe); return; }
                        }
                    }
                }
            }
            catch { }
        }

        // ---------- small building blocks ----------

        static TextBlock Label(string text, double size, FontWeight weight, Color color, Thickness margin)
        {
            var t = new TextBlock { Text = text };
            StyleText(t, size, weight, color, margin);
            return t;
        }

        static void StyleText(TextBlock t, double size, FontWeight weight, Color color, Thickness margin)
        {
            t.FontFamily = Theme.Sans; t.FontSize = size; t.FontWeight = weight; t.Foreground = Theme.Brush(color);
            t.Margin = margin; t.TextWrapping = TextWrapping.Wrap;
        }

        static UIElement Feature(string glyph, string title, string text)
        {
            var row = new DockPanel { Margin = new Thickness(0, 0, 0, 18) };
            var icon = new Border
            {
                Width = 38, Height = 38, CornerRadius = new CornerRadius(11), Background = Theme.Brush(Theme.Teal, 0.16),
                Margin = new Thickness(0, 0, 14, 0), VerticalAlignment = VerticalAlignment.Top,
                Child = new TextBlock { Text = glyph, FontSize = 17, Foreground = Theme.Brush(Theme.TealLight),
                    HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center }
            };
            DockPanel.SetDock(icon, Dock.Left);
            row.Children.Add(icon);
            var words = new StackPanel();
            words.Children.Add(Label(title, 15, FontWeights.SemiBold, Theme.Text, new Thickness(0, 0, 0, 2)));
            words.Children.Add(Label(text, 13, FontWeights.Normal, Theme.Muted, new Thickness(0)));
            row.Children.Add(words);
            return row;
        }

        static UIElement Button(string text, bool primary, Action onClick)
        {
            var normal = primary ? Theme.Brush(Theme.Teal) : Theme.Brush(Theme.Panel);
            var hover = primary ? Theme.Brush(Theme.TealLight) : Theme.Brush(Theme.Line);
            var b = new Border
            {
                CornerRadius = new CornerRadius(11), Background = normal, Padding = new Thickness(22, 11, 22, 11),
                Margin = new Thickness(0, 0, 10, 0), Cursor = Cursors.Hand,
                BorderBrush = Theme.Brush(primary ? Theme.Teal : Theme.Line), BorderThickness = new Thickness(1),
                Child = new TextBlock { Text = text, FontFamily = Theme.Sans, FontSize = 14, FontWeight = FontWeights.SemiBold,
                    Foreground = primary ? Brushes.White : Theme.Brush(Theme.Text) }
            };
            b.MouseEnter += delegate { b.Background = hover; };
            b.MouseLeave += delegate { b.Background = normal; };
            // Keep the press from reaching the card, whose DragMove would swallow the click.
            b.MouseLeftButtonDown += delegate(object s, MouseButtonEventArgs e) { e.Handled = true; };
            b.MouseLeftButtonUp += delegate { onClick(); };
            return b;
        }

        static BitmapImage LoadImage(string name)
        {
            var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name);
            if (stream == null) return null;
            var img = new BitmapImage();
            img.BeginInit(); img.StreamSource = stream; img.CacheOption = BitmapCacheOption.OnLoad; img.EndInit();
            return img;
        }
    }

    /// One line of the install steps: pending → running → done.
    class StepRow : StackPanel
    {
        readonly Ellipse dot = new Ellipse { Width = 10, Height = 10, Margin = new Thickness(2, 0, 14, 0), VerticalAlignment = VerticalAlignment.Center };
        readonly TextBlock label = new TextBlock { FontFamily = Theme.Sans, FontSize = 14, VerticalAlignment = VerticalAlignment.Center };

        public StepRow(string text)
        {
            Orientation = Orientation.Horizontal;
            Margin = new Thickness(0, 0, 0, 12);
            label.Text = text;
            Children.Add(dot);
            Children.Add(label);
            Reset();
        }

        public void Reset() { dot.Fill = Theme.Brush(Theme.Line); label.Foreground = Theme.Brush(Theme.Faint); dot.BeginAnimation(OpacityProperty, null); }

        public void Active()
        {
            dot.Fill = Theme.Brush(Theme.TealLight); label.Foreground = Theme.Brush(Theme.Text);
            dot.BeginAnimation(OpacityProperty, new DoubleAnimation(1, 0.35, TimeSpan.FromMilliseconds(600)) { AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever });
        }

        public void Done()
        {
            dot.BeginAnimation(OpacityProperty, null);
            dot.Opacity = 1; dot.Fill = Theme.Brush(Theme.Teal); label.Foreground = Theme.Brush(Theme.Muted);
            label.Text = "✓  " + label.Text.TrimStart('✓', ' ');
        }
    }
}
