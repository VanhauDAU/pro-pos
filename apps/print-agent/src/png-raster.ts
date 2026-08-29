import { inflateSync } from 'node:zlib';

import { imageDataToEscPosRaster, type RasterImageData } from '@printing/escpos/escpos-raster';

function readUint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}

function paeth(left: number, above: number, upperLeft: number): number {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function decodePng(bytes: Uint8Array): RasterImageData {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (signature.some((value, index) => bytes[index] !== value)) {
    throw new Error('Print Agent hiện chỉ raster hóa ảnh PNG.');
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const imageChunks: Uint8Array[] = [];

  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = readUint32(bytes, offset);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    const data = bytes.slice(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = readUint32(data, 0);
      height = readUint32(data, 4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      transparency = data;
    } else if (type === 'IDAT') {
      imageChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += length + 12;
  }

  if (!width || !height || bitDepth !== 8 || interlace !== 0 || imageChunks.length === 0) {
    throw new Error('PNG không được hỗ trợ (cần PNG 8-bit, non-interlaced).');
  }
  if (width > 4_096 || height > 4_096 || width * height > 8_000_000) {
    throw new Error('Ảnh PNG quá lớn để raster hóa an toàn.');
  }
  const channels =
    colorType === 0 || colorType === 3
      ? 1
      : colorType === 2
        ? 3
        : colorType === 4
          ? 2
          : colorType === 6
            ? 4
            : 0;
  if (!channels) throw new Error(`PNG color type ${colorType} không được hỗ trợ.`);
  if (colorType === 3 && !palette) throw new Error('PNG palette bị thiếu.');

  const compressedLength = imageChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const compressed = new Uint8Array(compressedLength);
  let chunkOffset = 0;
  for (const chunk of imageChunks) {
    compressed.set(chunk, chunkOffset);
    chunkOffset += chunk.length;
  }
  const rowBytes = width * channels;
  const expectedInflatedLength = (rowBytes + 1) * height;
  const inflated = new Uint8Array(
    inflateSync(compressed, { maxOutputLength: expectedInflatedLength }),
  );
  if (inflated.length !== (rowBytes + 1) * height) throw new Error('Dữ liệu PNG bị thiếu.');
  const raw = new Uint8Array(rowBytes * height);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset++]!;
    const rowStart = y * rowBytes;
    const aboveStart = rowStart - rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const source = inflated[sourceOffset++]!;
      const left = x >= channels ? raw[rowStart + x - channels]! : 0;
      const above = y > 0 ? raw[aboveStart + x]! : 0;
      const upperLeft = y > 0 && x >= channels ? raw[aboveStart + x - channels]! : 0;
      const reconstructed =
        filter === 0
          ? source
          : filter === 1
            ? source + left
            : filter === 2
              ? source + above
              : filter === 3
                ? source + Math.floor((left + above) / 2)
                : filter === 4
                  ? source + paeth(left, above, upperLeft)
                  : Number.NaN;
      if (!Number.isFinite(reconstructed)) throw new Error(`PNG filter ${filter} không hợp lệ.`);
      raw[rowStart + x] = reconstructed & 0xff;
    }
  }

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const source = pixel * channels;
    const target = pixel * 4;
    if (colorType === 0) {
      rgba[target] = raw[source]!;
      rgba[target + 1] = raw[source]!;
      rgba[target + 2] = raw[source]!;
      rgba[target + 3] = 255;
    } else if (colorType === 2) {
      rgba[target] = raw[source]!;
      rgba[target + 1] = raw[source + 1]!;
      rgba[target + 2] = raw[source + 2]!;
      rgba[target + 3] = 255;
    } else if (colorType === 3) {
      const paletteIndex = raw[source]!;
      rgba[target] = palette![paletteIndex * 3] ?? 255;
      rgba[target + 1] = palette![paletteIndex * 3 + 1] ?? 255;
      rgba[target + 2] = palette![paletteIndex * 3 + 2] ?? 255;
      rgba[target + 3] = transparency?.[paletteIndex] ?? 255;
    } else if (colorType === 4) {
      rgba[target] = raw[source]!;
      rgba[target + 1] = raw[source]!;
      rgba[target + 2] = raw[source]!;
      rgba[target + 3] = raw[source + 1]!;
    } else {
      rgba[target] = raw[source]!;
      rgba[target + 1] = raw[source + 1]!;
      rgba[target + 2] = raw[source + 2]!;
      rgba[target + 3] = raw[source + 3]!;
    }
  }
  return { width, height, data: rgba };
}

function resizeToFit(image: RasterImageData, maxWidth: number, maxHeight: number): RasterImageData {
  const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  if (width === image.width && height === image.height) return image;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor(x / scale));
      const source = (sourceY * image.width + sourceX) * 4;
      const target = (y * width + x) * 4;
      data.set(image.data.subarray(source, source + 4), target);
    }
  }
  return { width, height, data };
}

export function pngBytesToEscPosRaster(
  bytes: Uint8Array,
  maximumWidthDots: number,
  maximumHeightDots: number,
): Uint8Array {
  const resized = resizeToFit(decodePng(bytes), maximumWidthDots, maximumHeightDots);
  return imageDataToEscPosRaster(resized, maximumWidthDots);
}
