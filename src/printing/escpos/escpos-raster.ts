import { PrinterError } from '../printer-errors';
import { rasterHeader } from './escpos-commands';

export interface RasterImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function imageDataToEscPosRaster(
  image: RasterImageData,
  maximumWidthDots: number,
  threshold = 170,
): Uint8Array {
  if (image.width <= 0 || image.height <= 0 || image.width > maximumWidthDots) {
    throw new PrinterError('RENDER_FAILED', `Ảnh hóa đơn vượt vùng in ${maximumWidthDots} dots.`);
  }
  if (image.height > 65_535 || image.data.length !== image.width * image.height * 4) {
    throw new PrinterError('RENDER_FAILED');
  }

  const widthBytes = Math.ceil(image.width / 8);
  const header = rasterHeader(widthBytes, image.height);
  const output = new Uint8Array(header.length + widthBytes * image.height);
  output.set(header);

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const pixel = (y * image.width + x) * 4;
      const alpha = image.data[pixel + 3]! / 255;
      const red = image.data[pixel]! * alpha + 255 * (1 - alpha);
      const green = image.data[pixel + 1]! * alpha + 255 * (1 - alpha);
      const blue = image.data[pixel + 2]! * alpha + 255 * (1 - alpha);
      const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
      if (luminance < threshold) {
        const byteIndex = header.length + y * widthBytes + (x >> 3);
        output[byteIndex] = output[byteIndex]! | (0x80 >> (x & 7));
      }
    }
  }
  return output;
}
