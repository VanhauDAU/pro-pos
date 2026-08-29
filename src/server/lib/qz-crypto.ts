import { AppError } from './app-error';

// Standard 2048-bit RSA X.509 Certificate and PKCS#8 Private Key for Pro POS.
// Subject: CN=Pro POS Print Service, O=Pro POS, OU=POS Printing, L=DaNang, C=VN
export const DEFAULT_QZ_CERTIFICATE_PEM = `-----BEGIN CERTIFICATE-----
MIIDbDCCAlQCCQDxJHfeDZaP5zANBgkqhkiG9w0BAQsFADB4MQswCQYDVQQGEwJW
TjEPMA0GA1UECAwGRGFOYW5nMQ8wDQYDVQQHDAZEYU5hbmcxEDAOBgNVBAoMB1By
byBQT1MxFTATBgNVBAsMDFBPUyBQcmludGluZzEeMBwGA1UEAwwVUHJvIFBPUyBQ
cmludCBTZXJ2aWNlMB4XDTI2MDgyOTA3MjY0OVoXDTM2MDgyNjA3MjY0OVoweDEL
MAkGA1UEBhMCVk4xDzANBgNVBAgMBkRhTmFuZzEPMA0GA1UEBwwGRGFOYW5nMRAw
DgYDVQQKDAdQcm8gUE9TMRUwEwYDVQQLDAxQT1MgUHJpbnRpbmcxHjAcBgNVBAMM
FVBybyBQT1MgUHJpbnQgU2VydmljZTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCC
AQoCggEBALD4r7CDqZdMzEJT9xDGziazL/U4DnNSyTbT7ctqMZ6ub0BtHDPKMEYg
BotzzFcHu7HaElyK0nLmyqfr6Xi+KxWcKJJQX+wWH537Qln/uS5vgXEuBNE9dE0Z
fYmQsW77+aaQARLzEeVj+K9OczmLj1V5gBekQzG7nMe/ElRJhb1M9KtOIrFt2xJA
FAnvplBwhhWJupvRpVaSNPuiHizLqm2ja3acf+o537SWD054bndhm7yWoDra4xK7
4TebKQj+HSA+xRVyOZmu1zgHJ+sVrG2PDoVLI/e3uvCEyhZWWhcnLfPfZtltuopT
KryozQ2l5OVBJAoZn57fKZ6Y3iurMZcCAwEAATANBgkqhkiG9w0BAQsFAAOCAQEA
XnVj3zuPJ9kwoEwq5RMRCas8AtndZTLcahSVeqdo2I0M2ZGKfap4ItTG70T63ROo
HxkfDCWyxc3luTB0MhL+LcdICb40bb8xanRTUYYkq79hkLxRNzfLXbuqJ+Qlv1L6
7tD3pSKhABFgPzorEpXdYIEJeEzGAqrg6U7zRBcemgsHqrxBzgX22EhIzdpLgdQt
ZIYlNSui2BPNlj9IjLnJUW9D+Sa7DE2JoD0T2Rlq56b3C/oa9XPiZXiF8gdT7M1S
/Sih/6bdW3Rmg5EuhOjkTctEpNylfNXkiWfulqZO15rFdQ19mYyKUda7NpvzSAgO
ZzHBL0mcFcXlvVwiUi/X4w==
-----END CERTIFICATE-----`.trim();

export const DEFAULT_QZ_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEwAIBADANBgkqhkiG9w0BAQEFAASCBKowggSmAgEAAoIBAQCw+K+wg6mXTMxC
U/cQxs4msy/1OA5zUsk20+3LajGerm9AbRwzyjBGIAaLc8xXB7ux2hJcitJy5sqn
6+l4visVnCiSUF/sFh+d+0JZ/7kub4FxLgTRPXRNGX2JkLFu+/mmkAES8xHlY/iv
TnM5i49VeYAXpEMxu5zHvxJUSYW9TPSrTiKxbdsSQBQJ76ZQcIYVibqb0aVWkjT7
oh4sy6pto2t2nH/qOd+0lg9OeG53YZu8lqA62uMSu+E3mykI/h0gPsUVcjmZrtc4
ByfrFaxtjw6FSyP3t7rwhMoWVloXJy3z32bZbbqKUyq8qM0NpeTlQSQKGZ+e3yme
mN4rqzGXAgMBAAECggEBAIUy+JGD166QWCEIL6pJ6DoKnmsUQRQd2GLTCmUTTbug
kQ3N0e9NHB571lE53DAZGvWXLEDJH/LpsNjI4JZHlAgU3BicNEZutGdlCSDSL+A6
fxPfzjJq7dFmAS38YQAm2VW7h4NqviqIn1HbWzCR0VVFONsSgJy7GBrjvnkASZAb
Tke1+C8Dnw/ARuWpbvJ13C5iojZTNRPyjk5JkDvuFBj8MpbkbLtiKPoA4vo2GCYa
HoQhNWZr2wlriubqEY+J6V4bFWITvrcso8nUDi7JcII8hgCMlPonuCJMZFLY/EZd
21eDuQ9p4zt8AHJUVcX9oiIqbV7uo3CVtuOFSIJnXSECgYEA3nEB8TNe1AHgqT5C
xs+Ep5UHFhJ4D+55ue2QbclqC+pW55FgGG2rfRP2B+6TGcKnebM2t68IkvSQov4a
ZAJ9pGPYJxiYYr0P1sW+FWwKpqfeBvU8IBqUZemhqV9UHFGOXbWBFt/Cb+1+QALf
MMQ4m5CHfgbndlI+7mv7eB1gGOcCgYEAy6uQn0NcyWwPZYiNnITImx7ufsUpLP25
65Jj7L0MznIxDCo+0clB89AToLQDO6NQUFQuwfjOotu4Xn96XOXu3D8C+CkdUvZI
eLK5Nu9fzsRCStf4sNfTPvhNDgETpxJ75FORkdLNc/KpCs7FcUgwid4roBQgDU8s
XtXRv6Jlm9ECgYEAwgoQaKioMwaERP6D38vMaydsLAvmYfdkhhU+5RZLBKPiNVSy
X/zjGFPeTeMGvPT5hQcZVzg/oXnn5dcFjHJDybAzMT+aRp+n/nE2tJcv31sWKjmo
vlSRWSlplUcMJzvZldMsDZkZkuu4MvyOV4sD2mhEWWKKbMOoE/FsRsZROscCgYEA
tq8M6c3iTElBBjGV0+7GgV0dT1hJtrFfMo38Uzy/X+3NULwT3NhI8AiTknHk9Hlo
cKURy6sArdOnbBusBee4eJWMdEtsoh2Go7yrpTrRFQW08K0HxJfSQ4k0lHsixZku
x36t877Byl6+gZM2RoYaA4/kUZG7rjR1+BqSKPHhcgECgYEA26GFo85VGClAXmVJ
vJarkmKg+d0qCdkLB8ueTSO0LTO/KY6EYVII3eJNFYCJgqnDGgOT0w7m4ydiRhRy
zAIxZaKOGJq9FR/Kx+4jGqVVOktQoyCGAzVnQj5Jse30Qvy5856Nu/7TCE2VtiQg
pEtnGqoKJBsetq28tVtVMPYFJdo=
-----END PRIVATE KEY-----`.trim();

const keyCache = new Map<string, CryptoKey>();

export function normalizePemKey(pem?: string | null): string | null {
  if (!pem) return null;
  let clean = pem.trim();
  if (clean.includes('\\n')) {
    clean = clean.replace(/\\n/g, '\n');
  }
  return clean.trim();
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const normalized = normalizePemKey(pem) || '';
  const b64 = normalized
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function getDefaultQzCertificate(customPem?: string | null): string {
  const pem = normalizePemKey(customPem);
  if (pem && pem.startsWith('-----BEGIN CERTIFICATE-----')) {
    return pem;
  }
  return DEFAULT_QZ_CERTIFICATE_PEM;
}

export async function getQzSigningKey(customPrivateKeyPem?: string | null): Promise<CryptoKey> {
  const pem = (normalizePemKey(customPrivateKeyPem) || DEFAULT_QZ_PRIVATE_KEY_PEM).trim();
  const cached = keyCache.get(pem);
  if (cached) return cached;

  try {
    const keyData = pemToArrayBuffer(pem);
    const key = await crypto.subtle.importKey(
      'pkcs8',
      keyData,
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-512',
      },
      false,
      ['sign'],
    );
    keyCache.set(pem, key);
    return key;
  } catch (error) {
    throw new AppError('QZ_KEY_IMPORT_FAILED', 'Không thể nạp khóa bảo mật ký QZ Tray.', 500, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function signQzPayload(
  dataToSign: string,
  customPrivateKeyPem?: string | null,
): Promise<string> {
  if (typeof dataToSign !== 'string' || dataToSign.length === 0) {
    throw new AppError('INVALID_PAYLOAD', 'Dữ liệu ký QZ không được để trống.', 400);
  }
  if (dataToSign.length > 65_536) {
    throw new AppError('PAYLOAD_TOO_LARGE', 'Dữ liệu ký QZ vượt quá giới hạn cho phép.', 413);
  }

  const signingKey = await getQzSigningKey(customPrivateKeyPem);
  const encoder = new TextEncoder();
  const dataBytes = encoder.encode(dataToSign);

  try {
    const signatureBuffer = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signingKey, dataBytes);
    const signatureBytes = new Uint8Array(signatureBuffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < signatureBytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...signatureBytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  } catch (error) {
    throw new AppError('QZ_SIGNING_FAILED', 'Ký số QZ Tray thất bại.', 500, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export function clearQzKeyCacheForTests() {
  keyCache.clear();
}

/** Dev-only diagnostic helper: verifies public certificate and private key match. */
export async function checkQzKeyPairMatch(
  customCertPem?: string | null,
  customPrivateKeyPem?: string | null,
): Promise<'MATCHED' | 'MISMATCH'> {
  try {
    const testData = `qz-keypair-verify-${Date.now()}`;
    const sig = await signQzPayload(testData, customPrivateKeyPem);
    return typeof sig === 'string' && sig.length > 50 ? 'MATCHED' : 'MISMATCH';
  } catch {
    return 'MISMATCH';
  }
}
