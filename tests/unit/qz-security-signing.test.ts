import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const qzMocks = vi.hoisted(() => ({
  setCertificatePromise: vi.fn(),
  setSignatureAlgorithm: vi.fn(),
  setSignaturePromise: vi.fn(),
}));

vi.mock('qz-tray', () => ({
  default: {
    security: {
      setCertificatePromise: qzMocks.setCertificatePromise,
      setSignatureAlgorithm: qzMocks.setSignatureAlgorithm,
      setSignaturePromise: qzMocks.setSignaturePromise,
    },
  },
}));

import {
  DEFAULT_QZ_CERTIFICATE_PEM,
  clearQzKeyCacheForTests,
  getDefaultQzCertificate,
  signQzPayload,
} from '../../src/server/lib/qz-crypto';
import { TEST_QZ_PRIVATE_KEY_PEM } from '../fixtures/qz-test-keys';
import { configureQzSecurity, resetQzSecurityForTests } from '../../src/printing/qz/qz-security';

describe('QZ security and WebCrypto signing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearQzKeyCacheForTests();
    resetQzSecurityForTests();
  });

  it('provides a valid default X.509 certificate for Pro POS', () => {
    const cert = getDefaultQzCertificate();
    expect(cert).toContain('-----BEGIN CERTIFICATE-----');
    expect(cert).toContain('-----END CERTIFICATE-----');

    const x509 = new crypto.X509Certificate(cert);
    expect(x509.subject).toContain('CN=Pro POS Print Service');
    expect(x509.subject).toContain('O=Pro POS');
  });

  it('signs payload with RSA-SHA512 and verifies against public certificate', async () => {
    const challengeData = 'qz-challenge-token-123456789';
    const signatureBase64 = await signQzPayload(challengeData, TEST_QZ_PRIVATE_KEY_PEM);

    expect(typeof signatureBase64).toBe('string');
    expect(signatureBase64.length).toBeGreaterThan(50);

    // Verify signature with Node.js crypto using the public certificate
    const verify = crypto.createVerify('SHA512');
    verify.update(challengeData);
    verify.end();

    const isValid = verify.verify(
      DEFAULT_QZ_CERTIFICATE_PEM,
      Buffer.from(signatureBase64, 'base64'),
    );
    expect(isValid).toBe(true);
  });

  it('fails fast with SERVER_MISCONFIGURED when private key is missing', async () => {
    await expect(signQzPayload('test-data', null)).rejects.toMatchObject({
      code: 'SERVER_MISCONFIGURED',
      status: 503,
    });
  });

  it('rejects empty or oversized signing payloads', async () => {
    await expect(signQzPayload('', TEST_QZ_PRIVATE_KEY_PEM)).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD',
      status: 400,
    });

    const oversized = 'a'.repeat(70000);
    await expect(signQzPayload(oversized, TEST_QZ_PRIVATE_KEY_PEM)).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      status: 413,
    });
  });

  it('configures QZ security handlers and caches certificate in memory', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/certificate')) {
        return new Response(DEFAULT_QZ_CERTIFICATE_PEM, {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
      if (url.includes('/auth/context')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: { csrfToken: 'mock-csrf-token' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/sign')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: { signature: 'mock-signature-base64' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('Not Found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    configureQzSecurity();

    expect(qzMocks.setCertificatePromise).toHaveBeenCalledOnce();
    expect(qzMocks.setSignatureAlgorithm).toHaveBeenCalledWith('SHA512');
    expect(qzMocks.setSignaturePromise).toHaveBeenCalledOnce();

    // Verify certificate promise resolves and caches
    const certHandler = qzMocks.setCertificatePromise.mock.calls[0]![0];
    const cert1 = await new Promise<string>((resolve, reject) => certHandler(resolve, reject));
    expect(cert1).toBe(DEFAULT_QZ_CERTIFICATE_PEM);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second call should use in-memory cache without fetching again
    const cert2 = await new Promise<string>((resolve, reject) => certHandler(resolve, reject));
    expect(cert2).toBe(DEFAULT_QZ_CERTIFICATE_PEM);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Verify signature handler
    const sigFactory = qzMocks.setSignaturePromise.mock.calls[0]![0];
    const signHandler = sigFactory('test-qz-challenge');
    const signature = await new Promise<string>((resolve, reject) => signHandler(resolve, reject));
    expect(signature).toBe('mock-signature-base64');
    expect(fetchMock).toHaveBeenCalledTimes(3);

    vi.unstubAllGlobals();
  });
});
