import { ESC_POS } from './escpos-commands';
import { imageDataToEscPosRaster, type RasterImageData } from './escpos-raster';

function concatBytes(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export interface EscPosReceiptOptions {
  printableDots: number;
  autoCut: boolean;
  openCashDrawer: boolean;
}

export function buildEscPosRasterReceipt(image: RasterImageData, options: EscPosReceiptOptions) {
  return concatBytes([
    ESC_POS.initialize,
    ESC_POS.alignCenter,
    imageDataToEscPosRaster(image, options.printableDots),
    ESC_POS.alignLeft,
    ESC_POS.feedFourLines,
    ...(options.openCashDrawer ? [ESC_POS.openCashDrawer] : []),
    ...(options.autoCut ? [ESC_POS.cut] : []),
  ]);
}

export function combineEscPosReceipts(receipts: Uint8Array[]) {
  return concatBytes(receipts);
}
