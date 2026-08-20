import { createHash, timingSafeEqual } from 'node:crypto';

const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export function randomOpaqueToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function randomSalt(byteLength = 16): string {
  return randomOpaqueToken(byteLength);
}

async function hmac(input: string, keyValue: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(keyValue),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(input)));
}

export async function hashOpaqueToken(token: string, pepper: string): Promise<string> {
  return bytesToBase64Url(await hmac(token, pepper));
}

export async function hashExchangeCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(code));
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function deriveDeterministicSecret(
  grantToken: string,
  idempotencyKey: string,
  pepper: string,
): Promise<string> {
  return bytesToBase64Url(await hmac(`device:${grantToken}:${idempotencyKey}`, pepper));
}

export async function deriveCsrfToken(credential: string, pepper: string): Promise<string> {
  return bytesToBase64Url(await hmac(`csrf:${credential}`, pepper));
}

export async function derivePinDigest(input: {
  pin: string;
  pepper: string;
  salt: string;
  userId: string;
  storeId: string;
}): Promise<string> {
  const value = ['employee-pin', 'v1', input.storeId, input.userId, input.salt, input.pin].join(
    '\u0000',
  );
  return bytesToBase64Url(await hmac(value, input.pepper));
}

export async function verifyPinDigest(input: {
  pin: string;
  pepper: string;
  salt: string;
  userId: string;
  storeId: string;
  expectedDigest: string;
}): Promise<boolean> {
  const actual = await derivePinDigest({
    pin: input.pin,
    pepper: input.pepper,
    salt: input.salt,
    userId: input.userId,
    storeId: input.storeId,
  });
  return safeEqualSecret(actual, input.expectedDigest);
}

export function safeEqualSecret(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left).digest();
  const rightDigest = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}
