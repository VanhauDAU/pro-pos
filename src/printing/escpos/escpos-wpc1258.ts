const WPC1258_PAGE = 52;
const ESC = 0x1b;

const SPECIAL_BYTES = new Map<number, number>([
  [0x20ac, 0x80], // €
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x0178, 0x9f],
  [0x0102, 0xc3], // Ă
  [0x0300, 0xcc], // combining grave
  [0x0110, 0xd0], // Đ
  [0x0309, 0xd2], // combining hook above
  [0x01a0, 0xd5], // Ơ
  [0x01af, 0xdd], // Ư
  [0x0303, 0xde], // combining tilde
  [0x0103, 0xe3], // ă
  [0x0301, 0xec], // combining acute
  [0x0111, 0xf0], // đ
  [0x0323, 0xf2], // combining dot below
  [0x01a1, 0xf5], // ơ
  [0x01b0, 0xfd], // ư
  [0x20ab, 0xfe], // ₫
]);

// These byte positions are reassigned by Windows-1258 and therefore cannot be
// emitted as their ISO-8859-1 code point values.
const REASSIGNED_LATIN1_BYTES = new Set([
  0xc3, 0xcc, 0xd0, 0xd2, 0xd5, 0xdd, 0xde, 0xe3, 0xec, 0xf0, 0xf2, 0xf5, 0xfd, 0xfe,
]);

const VIETNAMESE_TONE_MARKS = new Set(['\u0300', '\u0301', '\u0303', '\u0309', '\u0323']);

function canEncodeDirectly(codePoint: number): boolean {
  if (SPECIAL_BYTES.has(codePoint)) return true;
  if (codePoint >= 0 && codePoint <= 0x7f) return true;
  return codePoint >= 0xa0 && codePoint <= 0xff && !REASSIGNED_LATIN1_BYTES.has(codePoint);
}

/**
 * Windows-1258 stores only the Vietnamese combinations that do not already
 * have their own byte as base letter + a combining tone byte. Characters such
 * as ú/é/ó must remain composed because their byte is also used by ESC/POS
 * binary command parameters (for example the drawer pulse's 0xFA byte).
 */
export function normalizeVietnameseForWpc1258(input: string): string {
  let output = '';
  for (const character of input.normalize('NFC')) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && canEncodeDirectly(codePoint)) {
      output += character;
      continue;
    }

    const decomposed = character.normalize('NFD');
    let base = '';
    let tone = '';
    for (const part of decomposed) {
      if (VIETNAMESE_TONE_MARKS.has(part)) tone += part;
      else base += part;
    }
    output += base.normalize('NFC') + tone;
  }
  return output;
}

function encodeCodePoint(codePoint: number): number {
  const special = SPECIAL_BYTES.get(codePoint);
  if (special !== undefined) return special;

  if (codePoint >= 0 && codePoint <= 0x7f) return codePoint;
  if (codePoint >= 0xa0 && codePoint <= 0xff && !REASSIGNED_LATIN1_BYTES.has(codePoint)) {
    return codePoint;
  }

  // Thermal printers cannot display arbitrary Unicode in text mode. Replace
  // unsupported characters deterministically instead of leaking UTF-8 bytes.
  return 0x3f;
}

/** Encodes text into the single-byte WPC1258 table used by many ESC/POS printers. */
export function encodeWpc1258(input: string): Uint8Array {
  const normalized = normalizeVietnameseForWpc1258(input);
  const bytes: number[] = [];
  for (const character of normalized) {
    const codePoint = character.codePointAt(0);
    bytes.push(codePoint === undefined ? 0x3f : encodeCodePoint(codePoint));
  }
  return Uint8Array.from(bytes);
}

/**
 * Encodes a raw ESC/POS string and selects WPC1258 after ESC @ initialization.
 * Page 52 is the WPC1258 table on ESC/POS-compatible printers that expose the
 * extended Epson code-page map.
 */
export function encodeEscPosWpc1258(raw: string): Uint8Array {
  const startsWithInitialize = raw.charCodeAt(0) === ESC && raw.charCodeAt(1) === 0x40;
  const body = startsWithInitialize ? raw.slice(2) : raw;
  const encodedBody = encodeWpc1258(body);
  const prefix = startsWithInitialize
    ? Uint8Array.of(ESC, 0x40, ESC, 0x74, WPC1258_PAGE)
    : Uint8Array.of(ESC, 0x74, WPC1258_PAGE);

  const result = new Uint8Array(prefix.length + encodedBody.length);
  result.set(prefix, 0);
  result.set(encodedBody, prefix.length);
  return result;
}
