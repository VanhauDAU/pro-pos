export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const UTF8_FLAG = 0x0800;
const ZIP_VERSION = 20;

function writeUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTimestamp(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function concatBytes(parts: Uint8Array[], totalLength: number) {
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/** Creates a standards-compatible ZIP archive using the STORE method. PNG is already compressed. */
export function createZip(entries: ZipEntry[], modifiedAt = new Date()) {
  if (entries.length > 0xffff) throw new Error('ZIP_TOO_MANY_ENTRIES');

  const encoder = new TextEncoder();
  const timestamp = dosTimestamp(modifiedAt);
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  let centralLength = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    if (name.length > 0xffff) throw new Error('ZIP_FILENAME_TOO_LONG');
    if (entry.data.length > 0xffffffff) throw new Error('ZIP_ENTRY_TOO_LARGE');

    const checksum = crc32(entry.data);
    const localHeader = new Uint8Array(30 + name.length);
    const localView = new DataView(localHeader.buffer);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, ZIP_VERSION);
    writeUint16(localView, 6, UTF8_FLAG);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, timestamp.time);
    writeUint16(localView, 12, timestamp.date);
    writeUint32(localView, 14, checksum);
    writeUint32(localView, 18, entry.data.length);
    writeUint32(localView, 22, entry.data.length);
    writeUint16(localView, 26, name.length);
    writeUint16(localView, 28, 0);
    localHeader.set(name, 30);
    localParts.push(localHeader, entry.data);

    const centralHeader = new Uint8Array(46 + name.length);
    const centralView = new DataView(centralHeader.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, ZIP_VERSION);
    writeUint16(centralView, 6, ZIP_VERSION);
    writeUint16(centralView, 8, UTF8_FLAG);
    writeUint16(centralView, 10, 0);
    writeUint16(centralView, 12, timestamp.time);
    writeUint16(centralView, 14, timestamp.date);
    writeUint32(centralView, 16, checksum);
    writeUint32(centralView, 20, entry.data.length);
    writeUint32(centralView, 24, entry.data.length);
    writeUint16(centralView, 28, name.length);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, localOffset);
    centralHeader.set(name, 46);
    centralParts.push(centralHeader);

    localOffset += localHeader.length + entry.data.length;
    centralLength += centralHeader.length;
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, entries.length);
  writeUint16(endView, 10, entries.length);
  writeUint32(endView, 12, centralLength);
  writeUint32(endView, 16, localOffset);
  writeUint16(endView, 20, 0);

  return concatBytes(
    [...localParts, ...centralParts, end],
    localOffset + centralLength + end.length,
  );
}

export function dataUrlToBytes(dataUrl: string) {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0 || !dataUrl.slice(0, commaIndex).includes(';base64')) {
    throw new Error('INVALID_BASE64_DATA_URL');
  }
  const binary = atob(dataUrl.slice(commaIndex + 1));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function fileNameSlug(value: string, fallback: string) {
  const normalized = value
    .trim()
    .replaceAll(/đ/giu, (character) => (character === 'Đ' ? 'D' : 'd'))
    .normalize('NFD')
    .replaceAll(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('vi-VN')
    .replaceAll(/[^a-z0-9]+/gu, '_')
    .replaceAll(/_(?=\d)/gu, '')
    .replaceAll(/^_+|_+$/gu, '');
  return normalized || fallback;
}
