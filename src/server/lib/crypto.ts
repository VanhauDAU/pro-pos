import { timingSafeEqual } from 'node:crypto';

const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
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

export async function derivePasswordDigest(input: {
  secret: string;
  pepper: string;
  salt: string;
  iterations: number;
}): Promise<string> {
  const saltBytes = base64UrlToBytes(input.salt);
  const salt = saltBytes.buffer.slice(
    saltBytes.byteOffset,
    saltBytes.byteOffset + saltBytes.byteLength,
  ) as ArrayBuffer;
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`${input.secret}\u0000${input.pepper}`),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations: input.iterations,
    },
    keyMaterial,
    256,
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

export async function verifyPasswordDigest(input: {
  candidate: string;
  pepper: string;
  salt: string;
  iterations: number;
  expectedDigest: string;
}): Promise<boolean> {
  const actual = await derivePasswordDigest({
    secret: input.candidate,
    pepper: input.pepper,
    salt: input.salt,
    iterations: input.iterations,
  });
  const actualBytes = base64UrlToBytes(actual);
  const expectedBytes = base64UrlToBytes(input.expectedDigest);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function safeEqualSecret(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
