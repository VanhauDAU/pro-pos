import { describe, expect, it } from 'vitest';

import {
  encodeEscPosWpc1258,
  encodeWpc1258,
  normalizeVietnameseForWpc1258,
} from '../../src/printing/escpos/escpos-wpc1258';

describe('ESC/POS WPC1258 encoding', () => {
  it('converts precomposed Vietnamese tone characters to WPC1258 combining bytes', () => {
    expect(normalizeVietnameseForWpc1258('Nước Cam · TỔNG TIỀN')).toBe('Nước Cam · TỔNG TIỀN');

    const encoded = Array.from(encodeWpc1258('Nước Cam · TỔNG TIỀN'));
    expect(encoded).toContain(0xfd); // ư
    expect(encoded).toContain(0xf5); // ơ
    expect(encoded).toContain(0xec); // acute
    expect(encoded).toContain(0xd2); // hook above
    expect(encoded).not.toEqual(Array.from(new TextEncoder().encode('Nước Cam · TỔNG TIỀN')));
  });

  it('selects WPC1258 page 52 after ESC @ initialization', () => {
    const payload = encodeEscPosWpc1258('\x1b\x40HÓA ĐƠN THANH TOÁN\n');
    expect(Array.from(payload.slice(0, 5))).toEqual([0x1b, 0x40, 0x1b, 0x74, 52]);
    expect(payload[5]).toBe(0x48); // H
  });

  it('preserves ESC/POS binary command parameter bytes', () => {
    const drawerCommand = '\x1b\x70\x00\x19\xfa';
    const payload = encodeEscPosWpc1258(`\x1b\x40Hóa đơn\n${drawerCommand}`);
    expect(Array.from(payload.slice(-5))).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa]);
  });

  it('never leaks unsupported Unicode as UTF-8 bytes', () => {
    const payload = encodeWpc1258('Cảm ơn quý khách 🎱');
    expect(payload[payload.length - 1]).toBe(0x3f);
  });
});
