import { Hono } from 'hono';
import { z } from 'zod';

import { AppError } from '@server/lib/app-error';
import { getDefaultQzCertificate, signQzPayload } from '@server/lib/qz-crypto';
import { success } from '@server/lib/response';
import { parseJson } from '@server/lib/validation';
import { requireActor } from '@server/middleware/authorization';
import type { AppEnv } from '@server/types';

export const qzSignRequestSchema = z.object({
  data: z.string().min(1, 'Dữ liệu ký không được để trống').max(65536, 'Dữ liệu ký quá dài'),
});

export const qzRoutes = new Hono<AppEnv>();

/**
 * GET /api/v1/pos/printing/qz/certificate
 * Trả về chứng chỉ X.509 công khai để QZ Tray nhận diện và lưu vào Trusted keystore.
 */
qzRoutes.get('/certificate', (c) => {
  const envKey = (c.env as unknown as Record<string, unknown>)?.QZ_CERTIFICATE as
    string | undefined;
  const cert = getDefaultQzCertificate(envKey);

  const accept = c.req.header('Accept') || '';
  if (accept.includes('application/json')) {
    return success(c, { certificate: cert });
  }

  return new Response(cert, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    },
  });
});

/**
 * POST /api/v1/pos/printing/qz/sign
 * Ký dữ liệu challenge từ QZ Tray bằng thuật toán RSA-SHA512.
 * Yêu cầu xác thực phiên POS (OWNER hoặc EMPLOYEE thuộc store) và bảo vệ CSRF chuẩn.
 */
qzRoutes.post('/sign', requireActor('OWNER', 'EMPLOYEE'), async (c) => {
  const body = await parseJson(c.req.raw, qzSignRequestSchema);
  const privateKey = (c.env as unknown as Record<string, unknown>)?.QZ_PRIVATE_KEY as
    string | undefined;

  try {
    const signature = await signQzPayload(body.data, privateKey);
    return success(c, { signature });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('QZ_SIGNING_FAILED', 'Ký challenge QZ Tray thất bại.', 500, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
});
