export const ESC_POS = {
  initialize: Uint8Array.of(0x1b, 0x40),
  // Standard readable receipt face (usually 12x24 dots on a 203dpi printer).
  selectFontA: Uint8Array.of(0x1b, 0x4d, 0x00),
  // Compact receipt face (usually 9x17 dots) used by the Owner "Small" item size.
  selectFontB: Uint8Array.of(0x1b, 0x4d, 0x01),
  alignCenter: Uint8Array.of(0x1b, 0x61, 0x01),
  alignLeft: Uint8Array.of(0x1b, 0x61, 0x00),
  alignRight: Uint8Array.of(0x1b, 0x61, 0x02),
  boldOn: Uint8Array.of(0x1b, 0x45, 0x01),
  boldOff: Uint8Array.of(0x1b, 0x45, 0x00),
  doubleSizeOn: Uint8Array.of(0x1b, 0x21, 0x30),
  doubleHeightOn: Uint8Array.of(0x1b, 0x21, 0x10),
  resetSize: Uint8Array.of(0x1b, 0x21, 0x00),
  feedFourLines: Uint8Array.of(0x0a, 0x0a, 0x0a, 0x0a),
  cut: Uint8Array.of(0x1d, 0x56, 0x41, 0x00),
  openCashDrawer: Uint8Array.of(0x1b, 0x70, 0x00, 0x19, 0xfa),
} as const;

export function rasterHeader(widthBytes: number, height: number) {
  return Uint8Array.of(
    0x1d,
    0x76,
    0x30,
    0x00,
    widthBytes & 0xff,
    (widthBytes >> 8) & 0xff,
    height & 0xff,
    (height >> 8) & 0xff,
  );
}

/**
 * Builds standard ESC/POS QR code command sequence (Model 2, Level M).
 */
export function buildEscPosQrCode(content: string, moduleSize = 6): Uint8Array {
  const encoder = new TextEncoder();
  const dataBytes = encoder.encode(content);
  const len = dataBytes.length + 3;
  const pL = len & 0xff;
  const pH = (len >> 8) & 0xff;

  const parts: Uint8Array[] = [
    ESC_POS.alignCenter,
    // 1. Model 2: 1D 28 6B 04 00 31 41 32 00
    Uint8Array.of(0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00),
    // 2. Module size (1-16, standard 6): 1D 28 6B 03 00 31 43 <size>
    Uint8Array.of(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, Math.min(16, Math.max(1, moduleSize))),
    // 3. Error correction Level M: 1D 28 6B 03 00 31 45 31
    Uint8Array.of(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31),
    // 4. Store data: 1D 28 6B pL pH 31 50 30 <data>
    Uint8Array.of(0x1d, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30),
    dataBytes,
    // 5. Print QR: 1D 28 6B 03 00 31 51 30
    Uint8Array.of(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30),
    ESC_POS.alignLeft,
  ];

  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.length;
  }
  return combined;
}
