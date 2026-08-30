import { describe, expect, it, vi } from 'vitest';
import {
  WindowsRawPrinterTransport,
  type ProcessRunner,
} from '../../apps/print-agent/src/transports/windows-spooler-transport';
import { PrinterError } from '../../src/printing/printer-errors';

describe('WindowsRawPrinterTransport', () => {
  it('transfers Uint8Array ESC/POS binary bytes unmodified to runner stdin', async () => {
    const rawEscPos = new Uint8Array([
      0x1b, 0x40, 0x1b, 0x61, 0x01, 0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x0a, 0x1d, 0x56, 0x41, 0x00,
    ]);
    let capturedInput: Uint8Array | undefined;
    let capturedArgs: string[] = [];

    const mockRunner: ProcessRunner = vi.fn(async (_exe, args, input) => {
      capturedArgs = args;
      capturedInput = input;
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    const transport = new WindowsRawPrinterTransport(mockRunner);
    await transport.send(rawEscPos, {
      type: 'WINDOWS_PRINTER',
      printerName: 'POS-80 Printer',
    });

    expect(mockRunner).toHaveBeenCalledTimes(1);
    expect(capturedInput).toEqual(rawEscPos);
    expect(capturedInput?.byteLength).toBe(rawEscPos.length);
    expect(capturedArgs).toContain('POS-80 Printer');
  });

  it('safely passes Unicode and Vietnamese printer names in argument array without shell interpolation', async () => {
    let capturedArgs: string[] = [];
    const mockRunner: ProcessRunner = vi.fn(async (_exe, args, _input) => {
      capturedArgs = args;
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    const transport = new WindowsRawPrinterTransport(mockRunner);
    const complexPrinterName = 'Máy in Hóa đơn POS-80 (Tầng 1 & Bar)';
    await transport.send(new Uint8Array([0x1b, 0x40]), {
      type: 'WINDOWS_PRINTER',
      printerName: complexPrinterName,
    });

    expect(capturedArgs).toContain(complexPrinterName);
  });

  it('throws BEFORE_WRITE when printerName is empty', async () => {
    const mockRunner: ProcessRunner = vi.fn();
    const transport = new WindowsRawPrinterTransport(mockRunner);

    await expect(
      transport.send(new Uint8Array([0x1b, 0x40]), {
        type: 'WINDOWS_PRINTER',
        printerName: '   ',
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(PrinterError);
      const pe = err as PrinterError;
      expect(pe.code).toBe('INVALID_PRINTER_CONFIG');
      expect(pe.failureStage).toBe('BEFORE_WRITE');
      return true;
    });

    expect(mockRunner).not.toHaveBeenCalled();
  });

  it('maps Win32 1801 / PRINTER_NOT_FOUND error to WINDOWS_PRINTER_NOT_FOUND with BEFORE_WRITE', async () => {
    const mockRunner: ProcessRunner = vi.fn(async () => ({
      exitCode: 1801,
      stdout: '',
      stderr: 'WINSPOOL_ERROR_1801: The printer name is invalid.',
    }));

    const transport = new WindowsRawPrinterTransport(mockRunner);

    await expect(
      transport.send(new Uint8Array([0x1b, 0x40]), {
        type: 'WINDOWS_PRINTER',
        printerName: 'Unplugged Printer',
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(PrinterError);
      const pe = err as PrinterError;
      expect(pe.code).toBe('WINDOWS_PRINTER_NOT_FOUND');
      expect(pe.failureStage).toBe('BEFORE_WRITE');
      return true;
    });
  });

  it('maps partial write failure to WINDOWS_RAW_WRITE_FAILED with DURING_WRITE', async () => {
    const mockRunner: ProcessRunner = vi.fn(async () => ({
      exitCode: 10001,
      stdout: '',
      stderr: 'WINSPOOL_ERROR_10001: Written bytes do not match buffer length.',
    }));

    const transport = new WindowsRawPrinterTransport(mockRunner);

    await expect(
      transport.send(new Uint8Array([0x1b, 0x40, 0x41, 0x42]), {
        type: 'WINDOWS_PRINTER',
        printerName: 'POS-80 Printer',
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(PrinterError);
      const pe = err as PrinterError;
      expect(pe.code).toBe('WINDOWS_RAW_WRITE_FAILED');
      expect(pe.failureStage).toBe('DURING_WRITE');
      return true;
    });
  });

  it('rejects connection if connectionType is not WINDOWS_PRINTER', async () => {
    const mockRunner: ProcessRunner = vi.fn();
    const transport = new WindowsRawPrinterTransport(mockRunner);

    await expect(
      transport.send(new Uint8Array([0x1b]), {
        type: 'NETWORK_TCP',
        host: '192.168.1.50',
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(PrinterError);
      const pe = err as PrinterError;
      expect(pe.failureStage).toBe('BEFORE_WRITE');
      return true;
    });
  });
});
