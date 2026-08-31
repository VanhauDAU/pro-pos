param(
    [Parameter(Mandatory=$true)]
    [string]$PrinterName
)

$ErrorActionPreference = "Stop"

$pinvokeCode = @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFOW
    {
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int Level, [In] DOCINFOW pDocInfo);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static int SendBytes(string printerName, byte[] bytes)
    {
        IntPtr hPrinter = IntPtr.Zero;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
        {
            int err = Marshal.GetLastWin32Error();
            return err == 0 ? 1801 : err; // 1801 = ERROR_INVALID_PRINTER_NAME
        }

        DOCINFOW di = new DOCINFOW();
        di.pDocName = "PRO POS Print Job";
        di.pDataType = "RAW";

        try
        {
            if (!StartDocPrinter(hPrinter, 1, di))
            {
                return Marshal.GetLastWin32Error();
            }

            try
            {
                if (!StartPagePrinter(hPrinter))
                {
                    return Marshal.GetLastWin32Error();
                }

                IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
                try
                {
                    Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
                    int written = 0;
                    if (!WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out written))
                    {
                        return Marshal.GetLastWin32Error();
                    }
                    if (written != bytes.Length)
                    {
                        return 10001; // Partial write
                    }
                }
                finally
                {
                    Marshal.FreeCoTaskMem(pUnmanagedBytes);
                    EndPagePrinter(hPrinter);
                }
            }
            finally
            {
                EndDocPrinter(hPrinter);
            }
        }
        finally
        {
            ClosePrinter(hPrinter);
        }

        return 0; // Success
    }
}
"@

Add-Type -TypeDefinition $pinvokeCode -Language CSharp

$stdin = [System.Console]::OpenStandardInput()
$ms = New-Object System.IO.MemoryStream
$stdin.CopyTo($ms)
$bytes = $ms.ToArray()

if ($bytes.Length -eq 0) {
    [System.Console]::Error.WriteLine("EMPTY_INPUT")
    exit 20
}

$res = [RawPrinterHelper]::SendBytes($PrinterName, $bytes)
if ($res -ne 0) {
    [System.Console]::Error.WriteLine("WINSPOOL_ERROR_$res")
    exit $res
}

exit 0
