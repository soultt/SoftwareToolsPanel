param(
  [Parameter(Mandatory = $true)][string]$JsonPath
)

$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Drawing

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class HiResIcon
{
    [StructLayout(LayoutKind.Sequential)] public struct SIZE { public int cx; public int cy; }
    [Flags] public enum SIIGBF { RESIZETOFIT = 0, BIGGERSIZEOK = 1, MEMORYONLY = 2, ICONONLY = 4, THUMBNAILONLY = 8, INCACHEONLY = 16 }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b")]
    public interface IShellItemImageFactory
    {
        void GetImage(SIZE size, SIIGBF flags, out IntPtr phbm);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    public static extern void SHCreateItemFromParsingName(
        string path, IntPtr pbc, ref Guid riid,
        [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory item);

    [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr hObject);
    [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
    [DllImport("gdi32.dll")] public static extern int GetDIBits(IntPtr hdc, IntPtr hbm, uint start, uint lines, IntPtr bits, ref BITMAPINFO bmi, uint usage);
    [DllImport("gdi32.dll")] public static extern int GetObject(IntPtr hObject, int size, ref BITMAP bm);

    [StructLayout(LayoutKind.Sequential)] public struct BITMAP { public int bmType, bmWidth, bmHeight, bmWidthBytes; public short bmPlanes, bmBitsPixel; public IntPtr bmBits; }
    [StructLayout(LayoutKind.Sequential)] public struct BITMAPINFOHEADER {
        public int biSize, biWidth, biHeight; public short biPlanes, biBitCount; public int biCompression, biSizeImage, biXPelsPerMeter, biYPelsPerMeter, biClrUsed, biClrImportant;
    }
    [StructLayout(LayoutKind.Sequential)] public struct BITMAPINFO { public BITMAPINFOHEADER bmiHeader; public int bmiColors; }

    // Image.FromHbitmap drops the alpha channel (icons got white boxes); read 32bpp pixels via GetDIBits instead.
    public static bool Extract(string src, string dst, int size)
    {
        Guid iid = new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b");
        IShellItemImageFactory factory;
        SHCreateItemFromParsingName(src, IntPtr.Zero, ref iid, out factory);
        if (factory == null) return false;

        IntPtr hbitmap;
        SIZE s; s.cx = size; s.cy = size;
        factory.GetImage(s, SIIGBF.BIGGERSIZEOK, out hbitmap);
        if (hbitmap == IntPtr.Zero) { Marshal.ReleaseComObject(factory); return false; }

        try
        {
            BITMAP bm = new BITMAP();
            GetObject(hbitmap, Marshal.SizeOf(typeof(BITMAP)), ref bm);
            int w = bm.bmWidth, h = Math.Abs(bm.bmHeight);
            if (w <= 0 || h <= 0) return false;

            BITMAPINFO bmi = new BITMAPINFO();
            bmi.bmiHeader.biSize = Marshal.SizeOf(typeof(BITMAPINFOHEADER));
            bmi.bmiHeader.biWidth = w;
            bmi.bmiHeader.biHeight = -h;
            bmi.bmiHeader.biPlanes = 1;
            bmi.bmiHeader.biBitCount = 32;
            bmi.bmiHeader.biCompression = 0;

            using (Bitmap bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb))
            {
                BitmapData bd = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
                IntPtr hdc = GetDC(IntPtr.Zero);
                int ok = GetDIBits(hdc, hbitmap, 0, (uint)h, bd.Scan0, ref bmi, 0);
                ReleaseDC(IntPtr.Zero, hdc);
                bmp.UnlockBits(bd);
                if (ok == 0) return false;
                bmp.Save(dst, ImageFormat.Png);
            }
        }
        finally
        {
            DeleteObject(hbitmap);
            Marshal.ReleaseComObject(factory);
        }
        return true;
    }
}
"@

$jobs = Get-Content -LiteralPath $JsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($null -eq $jobs) { exit 0 }

foreach ($job in @($jobs)) {
  $out = [string]$job.out
  $src = [string]$job.src
  if ([string]::IsNullOrWhiteSpace($out) -or [string]::IsNullOrWhiteSpace($src)) { continue }
  $dir = Split-Path -Parent $out
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
  try { [HiResIcon]::Extract($src, $out, 256) | Out-Null } catch { }
}

exit 0
