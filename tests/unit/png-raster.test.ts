import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';

import { pngBytesToEscPosRaster } from '../../apps/print-agent/src/png-raster';

function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(data.length + 12);
  new DataView(bytes.buffer).setUint32(0, data.length, false);
  bytes.set(new TextEncoder().encode(type), 4);
  bytes.set(data, 8);
  // The decoder intentionally does not read the CRC; zeros keep the fixture focused on raster.
  return bytes;
}

describe('Print Agent PNG rasterization', () => {
  it('converts a supported PNG to an ESC/POS raster payload', () => {
    const ihdr = new Uint8Array(13);
    const ihdrView = new DataView(ihdr.buffer);
    ihdrView.setUint32(0, 1, false);
    ihdrView.setUint32(4, 1, false);
    ihdr.set([8, 6, 0, 0, 0], 8);
    const parts = [
      Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
      makePngChunk('IHDR', ihdr),
      makePngChunk('IDAT', new Uint8Array(deflateSync(Uint8Array.of(0, 0, 0, 0, 255)))),
      makePngChunk('IEND', new Uint8Array()),
    ];
    const png = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      png.set(part, offset);
      offset += part.length;
    }
    const raster = pngBytesToEscPosRaster(png, 576, 180);
    expect(Array.from(raster.slice(0, 8))).toEqual([
      0x1d, 0x76, 0x30, 0x00, 0x01, 0x00, 0x01, 0x00,
    ]);
    expect(raster).toHaveLength(9);
  });
});
