import qz from 'qz-tray';
import { apiRequest, jsonRequest } from '@client/lib/api';

let configured = false;
let cachedCertificate: string | null = null;
let cachedCsrfToken: string | null = null;

export const QZ_SIGNATURE_ALGORITHM = 'SHA512' as const;

export function setQzCsrfToken(token: string | null) {
  cachedCsrfToken = token;
}

async function resolveCsrfToken(): Promise<string> {
  if (cachedCsrfToken) return cachedCsrfToken;

  try {
    const authContext = await apiRequest<{ csrfToken?: string }>('/api/v1/auth/context');
    if (authContext?.csrfToken) {
      cachedCsrfToken = authContext.csrfToken;
      return cachedCsrfToken;
    }
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[QZ] Failed to fetch auth context for CSRF token:', error);
    }
  }

  return '';
}

/** Configure QZ security once. Private signing material always remains server-side. */
export function configureQzSecurity() {
  if (configured) return;
  configured = true;

  if (import.meta.env.DEV) {
    console.log('[QZ] security configuring...');
  }

  const certificateUrl =
    import.meta.env.VITE_QZ_CERTIFICATE_URL || '/api/v1/pos/printing/qz/certificate';
  const signatureUrl = import.meta.env.VITE_QZ_SIGNATURE_URL || '/api/v1/pos/printing/qz/sign';

  // 1. Certificate provider
  qz.security.setCertificatePromise((resolve, reject) => {
    if (cachedCertificate) {
      if (import.meta.env.DEV) {
        console.log('[QZ] certificate loaded from cache');
      }
      resolve(cachedCertificate);
      return;
    }

    void fetch(certificateUrl, {
      credentials: 'include',
      headers: { Accept: 'text/plain, application/json' },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`QZ certificate request failed (${response.status})`);
        }
        const text = await response.text();
        if (text.startsWith('{')) {
          try {
            const json = JSON.parse(text) as {
              data?: { certificate?: string };
              certificate?: string;
            };
            const cert = json.data?.certificate ?? json.certificate;
            if (cert) {
              cachedCertificate = cert.trim();
              if (import.meta.env.DEV) console.log('[QZ] certificate loaded');
              return cachedCertificate;
            }
          } catch {
            // fallback to raw text
          }
        }
        cachedCertificate = text.trim();
        if (import.meta.env.DEV) console.log('[QZ] certificate loaded');
        return cachedCertificate;
      })
      .then(resolve, (error) => {
        if (import.meta.env.DEV) {
          console.error('[QZ] failed to load certificate:', error);
        }
        reject(error instanceof Error ? error.message : String(error));
      });
  });

  // 2. Algorithm
  qz.security.setSignatureAlgorithm(QZ_SIGNATURE_ALGORITHM);

  // 3. Signature provider via shared API client
  qz.security.setSignaturePromise((dataToSign: string) => async (resolve, reject) => {
    try {
      if (import.meta.env.DEV) {
        console.log('[QZ] signature requested for challenge (len: ' + dataToSign.length + ')');
      }

      let csrfToken = await resolveCsrfToken();

      const doSign = async (token: string) => {
        return jsonRequest<{ signature: string }>(
          signatureUrl,
          { data: dataToSign },
          {
            headers: token ? { 'X-CSRF-Token': token } : {},
          },
        );
      };

      let result: { signature: string };
      try {
        result = await doSign(csrfToken);
      } catch (err: any) {
        // If 403 CSRF_TOKEN_INVALID, re-fetch fresh CSRF token from auth context and retry once
        if (err?.status === 403 || err?.code === 'CSRF_TOKEN_INVALID') {
          if (import.meta.env.DEV) {
            console.warn('[QZ] CSRF token expired or missing, refreshing auth context...');
          }
          cachedCsrfToken = null;
          csrfToken = await resolveCsrfToken();
          result = await doSign(csrfToken);
        } else {
          throw err;
        }
      }

      if (!result?.signature || typeof result.signature !== 'string') {
        throw new Error('QZ_SIGNATURE_INVALID: Chữ ký từ máy chủ rỗng hoặc không hợp lệ');
      }

      if (import.meta.env.DEV) {
        console.log('[QZ] sign status=200');
        console.log('[QZ] signature verified');
      }
      resolve(result.signature);
    } catch (error: any) {
      const status =
        error?.status ?? (error instanceof Error && error.message.includes('403') ? 403 : 'error');
      const errorCode = error?.code ?? error?.name ?? 'UNKNOWN';
      if (import.meta.env.DEV) {
        console.error(`[QZ] sign status=${status}`);
        console.error(`[QZ] auth error code=${errorCode}:`, error?.message || error);
      }
      reject(error instanceof Error ? error.message : String(error));
    }
  });

  if (import.meta.env.DEV) {
    console.log('[QZ] security configured successfully');
  }
}

export function resetQzSecurityForTests() {
  configured = false;
  cachedCertificate = null;
  cachedCsrfToken = null;
}
