import type { ZodType } from 'zod';

import { AppError } from '@server/lib/app-error';

export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const value = await request.json().catch(() => null);
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', 422, {
      issues: result.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    });
  }
  return result.data;
}

export async function parseJsonWithLimit<T>(
  request: Request,
  schema: ZodType<T>,
  maxBytes: number,
): Promise<T> {
  const declaredLength = Number(request.headers.get('Content-Length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new AppError('PAYLOAD_TOO_LARGE', 'Dữ liệu vượt giới hạn cho phép.', 422);
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw new AppError('PAYLOAD_TOO_LARGE', 'Dữ liệu vượt giới hạn cho phép.', 422);
  }
  let value: unknown = null;
  try {
    value = JSON.parse(raw);
  } catch {
    // The schema path below returns the standard validation response.
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', 422, {
      issues: result.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    });
  }
  return result.data;
}
