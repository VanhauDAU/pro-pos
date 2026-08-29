import type { ReceiptPrintProfile } from '@contracts/store';

import type { RasterImageData } from '../escpos/escpos-raster';

export interface ReceiptRenderRequest {
  html: string;
  profile: ReceiptPrintProfile;
}

export interface ReceiptRenderer {
  renderCopies(requests: ReceiptRenderRequest[]): Promise<RasterImageData[]>;
}
