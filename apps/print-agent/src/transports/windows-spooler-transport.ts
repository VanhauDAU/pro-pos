import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PrinterError } from '@printing/printer-errors';
import type { AgentPrinterConnection, AgentPrinterTransport } from './printer-transport';

export interface ProcessRunnerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type ProcessRunner = (
  executable: string,
  args: string[],
  input: Uint8Array,
) => Promise<ProcessRunnerResult>;

const DEFAULT_RUNNER: ProcessRunner = (executable, args, input) => {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(executable, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      return reject(err);
    }

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });

    try {
      child.stdin?.write(Buffer.from(input.buffer, input.byteOffset, input.byteLength));
      child.stdin?.end();
    } catch (err) {
      reject(err);
    }
  });
};

function resolveScriptPath(): string | null {
  const candidates = [
    join(__dirname, '../resources/winspool-raw-print.ps1'),
    join(__dirname, '../../resources/winspool-raw-print.ps1'),
    join(__dirname, 'resources/winspool-raw-print.ps1'),
    typeof process !== 'undefined' && process.resourcesPath
      ? join(process.resourcesPath, 'dist/desktop/resources/winspool-raw-print.ps1')
      : '',
    typeof process !== 'undefined' && process.resourcesPath
      ? join(
          process.resourcesPath,
          'app.asar.unpacked/dist/desktop/resources/winspool-raw-print.ps1',
        )
      : '',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export class WindowsRawPrinterTransport implements AgentPrinterTransport {
  constructor(private readonly runner: ProcessRunner = DEFAULT_RUNNER) {}

  async send(data: Uint8Array, connection: AgentPrinterConnection): Promise<void> {
    if (connection.type !== 'WINDOWS_PRINTER') {
      throw new PrinterError(
        'INVALID_PRINTER_CONFIG',
        'Cấu hình máy in không phải kiểu WINDOWS_PRINTER.',
        { failureStage: 'BEFORE_WRITE' },
      );
    }

    const printerName = connection.printerName?.trim();
    if (!printerName) {
      throw new PrinterError('INVALID_PRINTER_CONFIG', 'Tên máy in Windows không được để trống.', {
        failureStage: 'BEFORE_WRITE',
      });
    }

    if (data.byteLength === 0) {
      throw new PrinterError('PRINT_FAILED', 'Dữ liệu in trống.', { failureStage: 'BEFORE_WRITE' });
    }

    if (process.platform !== 'win32' && this.runner === DEFAULT_RUNNER) {
      throw new PrinterError(
        'INVALID_PRINTER_CONFIG',
        'Tính năng in qua Windows Spooler chỉ khả dụng trên hệ điều hành Windows.',
        { failureStage: 'BEFORE_WRITE' },
      );
    }

    const scriptPath = resolveScriptPath();
    let runnerArgs: string[];

    if (scriptPath) {
      runnerArgs = [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        '-PrinterName',
        printerName,
      ];
    } else {
      // Fallback: Inline base script reading from stdin
      const inlineScript = `
        param([string]$PrinterName)
        $ErrorActionPreference="Stop"
        $pinvoke=@"
using System;
using System.Runtime.InteropServices;
public class RawHelper {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public class DOCINFOW { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool OpenPrinter(string p, out IntPtr h, IntPtr d);
  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr h, int l, [In] DOCINFOW d);
  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr h, IntPtr b, int c, out int w);
  public static int Send(string p, byte[] b) {
    IntPtr h;
    if(!OpenPrinter(p, out h, IntPtr.Zero)) { int e=Marshal.GetLastWin32Error(); return e==0?1801:e; }
    DOCINFOW di=new DOCINFOW(); di.pDocName="PRO POS Print Job"; di.pDataType="RAW";
    try {
      if(!StartDocPrinter(h,1,di)) return Marshal.GetLastWin32Error();
      try {
        if(!StartPagePrinter(h)) return Marshal.GetLastWin32Error();
        IntPtr pB=Marshal.AllocCoTaskMem(b.Length);
        try {
          Marshal.Copy(b,0,pB,b.Length); int w=0;
          if(!WritePrinter(h,pB,b.Length,out w)) return Marshal.GetLastWin32Error();
          if(w!=b.Length) return 10001;
        } finally { Marshal.FreeCoTaskMem(pB); EndPagePrinter(h); }
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
    return 0;
  }
}
"@
        Add-Type -TypeDefinition $pinvoke -Language CSharp
        $ms=New-Object System.IO.MemoryStream
        [System.Console]::OpenStandardInput().CopyTo($ms)
        $b=$ms.ToArray()
        if($b.Length -eq 0) { [System.Console]::Error.WriteLine("EMPTY_INPUT"); exit 20 }
        $r=[RawHelper]::Send($PrinterName, $b)
        if($r -ne 0) { [System.Console]::Error.WriteLine("WINSPOOL_ERROR_$r"); exit $r }
        exit 0
      `;
      runnerArgs = [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        inlineScript,
        '-PrinterName',
        printerName,
      ];
    }

    let result: ProcessRunnerResult;
    try {
      result = await this.runner('powershell.exe', runnerArgs, data);
    } catch (err) {
      throw new PrinterError(
        'WINDOWS_SPOOLER_ERROR',
        `Không thể thực thi tiến trình Windows Print Spooler: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err, failureStage: 'BEFORE_WRITE' },
      );
    }

    if (result.exitCode === 0) {
      return;
    }

    const stderr = result.stderr || '';
    const isPartialWrite =
      result.exitCode === 10001 ||
      stderr.includes('WINSPOOL_ERROR_10001') ||
      stderr.includes('PARTIAL_WRITE');

    if (isPartialWrite) {
      throw new PrinterError(
        'WINDOWS_RAW_WRITE_FAILED',
        `Lỗi truyền một phần dữ liệu tới máy in "${printerName}".`,
        { failureStage: 'DURING_WRITE' },
      );
    }

    const isPrinterNotFound =
      result.exitCode === 1801 ||
      stderr.includes('WINSPOOL_ERROR_1801') ||
      stderr.includes('1801') ||
      /không tìm thấy|not found|invalid printer name/i.test(stderr);

    if (isPrinterNotFound) {
      throw new PrinterError(
        'WINDOWS_PRINTER_NOT_FOUND',
        `Không tìm thấy máy in "${printerName}" trên Windows. Vui lòng kiểm tra kết nối USB hoặc driver.`,
        { failureStage: 'BEFORE_WRITE' },
      );
    }

    // Default error mapping based on failure code
    const isDuringWrite = stderr.includes('WRITE_PRINTER_FAILED');
    throw new PrinterError(
      isDuringWrite ? 'WINDOWS_RAW_WRITE_FAILED' : 'WINDOWS_SPOOLER_ERROR',
      `Lỗi Windows Spooler khi in tới "${printerName}" (Exit code ${result.exitCode}): ${stderr.trim() || 'Lỗi không xác định'}`,
      { failureStage: isDuringWrite ? 'DURING_WRITE' : 'BEFORE_WRITE' },
    );
  }
}
