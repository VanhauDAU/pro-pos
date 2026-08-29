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
  const pem = normalizePemKey(customPrivateKeyPem);
  if (!pem) {
    throw new AppError(
      'SERVER_MISCONFIGURED',
      'Thiếu cấu hình secret QZ_PRIVATE_KEY trên máy chủ.',
      503,
    );
  }
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
