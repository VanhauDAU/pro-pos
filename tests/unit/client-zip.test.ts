import { describe, expect, it } from 'vitest';

import { createZip, dataUrlToBytes, fileNameSlug } from '@client/lib/zip';

describe('client ZIP utility', () => {
  it('creates a ZIP with UTF-8 filenames and the expected central directory', () => {
    const archive = createZip(
      [
        { name: 'tang1_ban1.png', data: new Uint8Array([1, 2, 3]) },
        { name: 'tang2_ban2.png', data: new Uint8Array([4, 5]) },
      ],
      new Date('2026-01-02T03:04:06'),
    );
    const view = new DataView(archive.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(archive.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(archive.length - 12, true)).toBe(2);
    expect(new TextDecoder().decode(archive)).toContain('tang1_ban1.png');
    expect(new TextDecoder().decode(archive)).toContain('tang2_ban2.png');
  });

  it('normalizes Vietnamese area and table names for downloaded files', () => {
    expect(fileNameSlug('Tầng 1', 'khu_vuc')).toBe('tang1');
    expect(fileNameSlug('Bàn VIP 01', 'ban')).toBe('ban_vip01');
    expect(fileNameSlug('---', 'ban')).toBe('ban');
  });

  it('converts a base64 data URL into bytes', () => {
    expect([...dataUrlToBytes('data:image/png;base64,AQID')]).toEqual([1, 2, 3]);
  });
});
