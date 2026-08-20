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
