import type { Context } from 'hono';

import type { AppEnv } from '@server/types';

export function success<T>(c: Context<AppEnv>, data: T, status: 200 | 201 | 202 = 200) {
  return c.json({ data }, status);
}

export function failure(
  c: Context<AppEnv>,
  error: { code: string; message: string; details?: unknown },
  status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503,
) {
  const body: {
    error: { code: string; message: string; requestId: string; details?: unknown };
  } = {
    error: {
      code: error.code,
      message: error.message,
      requestId: c.get('requestId'),
    },
  };

  if (error.details !== undefined) {
    body.error.details = error.details;
  }

  return c.json(body, status);
}
