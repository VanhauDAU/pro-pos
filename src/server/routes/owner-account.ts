import { Hono } from 'hono';

import {
  changePasswordRequestSchema,
  updateOwnerAccountSchema,
  type OwnerAccountProfile,
} from '@contracts/auth';
import { AppError } from '@server/lib/app-error';
import { readCredentialCookie } from '@server/lib/cookies';
import { success } from '@server/lib/response';
import { assertCsrf } from '@server/lib/security';
import { parseJson } from '@server/lib/validation';
import { requireActor } from '@server/middleware/authorization';
import { AuditRepository } from '@server/repositories/audit-repository';
import { AuthService } from '@server/services/auth-service';
import type { AppEnv } from '@server/types';

const ownerAccountRoutes = new Hono<AppEnv>();
ownerAccountRoutes.use('*', requireActor('OWNER'));

ownerAccountRoutes.get('/', async (c) => {
  const actor = c.get('actor');
  const user = await c.env.DB.prepare(
    `SELECT
      u.id, u.username, u.display_name AS displayName, u.email, u.phone,
      u.status, u.created_at AS createdAt, s.id AS storeId, s.name AS storeName
    FROM users u
    JOIN store_memberships sm ON sm.user_id = u.id AND sm.store_id = ?
    JOIN stores s ON s.id = sm.store_id
    WHERE u.id = ? LIMIT 1`,
  )
    .bind(actor.storeId, actor.id)
    .first<OwnerAccountProfile>();

  if (!user) {
    throw new AppError('USER_NOT_FOUND', 'Không tìm thấy thông tin tài khoản.', 404);
  }

  return success(c, user);
});

ownerAccountRoutes.put('/', async (c) => {
  const rawSession = readCredentialCookie(c, 'session');
  if (rawSession) {
    await assertCsrf(c, rawSession);
  }

  const actor = c.get('actor');
  const body = await parseJson(c.req.raw, updateOwnerAccountSchema);
  const now = Date.now();

  const normalizedDisplayName = body.displayName.trim();
  const normalizedPhone = body.phone ? body.phone.trim() : null;
  const normalizedEmail = body.email ? body.email.trim().toLowerCase() : null;

  // If email is provided, verify it's not already used by another user
  if (normalizedEmail) {
    const existing = await c.env.DB.prepare(
      'SELECT id FROM users WHERE email = ? COLLATE NOCASE AND id <> ? LIMIT 1',
    )
      .bind(normalizedEmail, actor.id)
      .first<{ id: string }>();

    if (existing) {
      throw new AppError(
        'EMAIL_ALREADY_IN_USE',
        'Email này đã được sử dụng bởi một tài khoản khác trong hệ thống.',
        409,
      );
    }
  }

  const before = await c.env.DB.prepare(
    'SELECT id, username, display_name AS displayName, email, phone, status FROM users WHERE id = ? LIMIT 1',
  )
    .bind(actor.id)
    .first();

  await c.env.DB.prepare(
    `UPDATE users
     SET display_name = ?, email = ?, phone = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(normalizedDisplayName, normalizedEmail, normalizedPhone, now, actor.id)
    .run();

  if (actor.storeId) {
    await new AuditRepository(c.env.DB).record({
      storeId: actor.storeId,
      context: {
        actorUserId: actor.id,
        actorSessionId: c.get('sessionId'),
        deviceId: c.get('device')?.id ?? null,
        requestId: c.get('requestId'),
      },
      action: 'OWNER_ACCOUNT_UPDATED',
      entityType: 'USER',
      entityId: actor.id,
      before,
      after: {
        displayName: normalizedDisplayName,
        email: normalizedEmail,
        phone: normalizedPhone,
        updatedAt: now,
      },
      now,
    });
  }

  const updated = await c.env.DB.prepare(
    `SELECT
      u.id, u.username, u.display_name AS displayName, u.email, u.phone,
      u.status, u.created_at AS createdAt, s.id AS storeId, s.name AS storeName
    FROM users u
    JOIN store_memberships sm ON sm.user_id = u.id AND sm.store_id = ?
    JOIN stores s ON s.id = sm.store_id
    WHERE u.id = ? LIMIT 1`,
  )
    .bind(actor.storeId, actor.id)
    .first<OwnerAccountProfile>();

  return success(c, updated);
});

ownerAccountRoutes.post('/change-password', async (c) => {
  const rawSession = readCredentialCookie(c, 'session');
  if (rawSession) {
    await assertCsrf(c, rawSession);
  }

  const actor = c.get('actor');
  const body = await parseJson(c.req.raw, changePasswordRequestSchema);
  const result = await new AuthService(c.env).changePassword({
    userId: actor.id,
    currentPassword: body.currentPassword,
    newPassword: body.newPassword,
  });

  return success(c, result);
});

export { ownerAccountRoutes };
