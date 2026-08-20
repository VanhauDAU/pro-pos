import type { Context } from 'hono';

import { AppError } from '@server/lib/app-error';
import { deriveCsrfToken } from '@server/lib/crypto';
import { requireSecret } from '@server/lib/env';
import type { AppEnv } from '@server/types';

export function assertSameOrigin(c: Context<AppEnv>) {
  const origin = c.req.header('Origin');
  if (!origin && c.env.ENVIRONMENT === 'local') {
    return;
  }
  if (!origin || origin !== new URL(c.req.url).origin) {
    throw new AppError('CSRF_ORIGIN_REJECTED', 'Yêu cầu không hợp lệ.', 403);
  }
}

export async function assertCsrf(c: Context<AppEnv>, credential: string): Promise<void> {
  assertSameOrigin(c);
  const provided = c.req.header('X-CSRF-Token');
  const expected = await deriveCsrfToken(
    credential,
    requireSecret(c.env.AUTH_PEPPER, 'AUTH_PEPPER'),
  );
  if (!provided || provided !== expected) {
    throw new AppError('CSRF_TOKEN_INVALID', 'Yêu cầu không hợp lệ.', 403);
  }
}
