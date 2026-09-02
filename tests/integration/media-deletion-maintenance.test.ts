import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MediaService } from '@server/services/media-service';
import { MaintenanceService } from '@server/services/maintenance-service';

describe('Media deletion maintenance', () => {
  let storeId: string;
  let userId: string;

  beforeEach(async () => {
    const suffix = crypto.randomUUID();
    storeId = `store-media-cleanup-${suffix}`;
    userId = `user-media-cleanup-${suffix}`;
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO stores (id, name, status, created_at, updated_at)
         VALUES (?, 'Media Cleanup Store', 'ACTIVE', ?, ?)`,
      ).bind(storeId, now, now),
      env.DB.prepare(
        `INSERT INTO users (id, username, display_name, status, created_at, updated_at)
         VALUES (?, ?, 'Media Cleanup User', 'ACTIVE', ?, ?)`,
      ).bind(userId, `media_${suffix}`, now, now),
    ]);
  });

  it('retains failed R2 tombstones for retry and never touches ACTIVE media', async () => {
    const now = Date.now();
    const tenDaysAgo = now - 10 * 24 * 60 * 60 * 1000;
    const deletedMediaId = crypto.randomUUID();
    const activeMediaId = crypto.randomUUID();
    const deletedObjectKey = `stores/${storeId}/media/${deletedMediaId}.png`;
    const activeObjectKey = `stores/${storeId}/media/${activeMediaId}.png`;
    const body = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

    await Promise.all([
      env.MEDIA.put(deletedObjectKey, body),
      env.MEDIA.put(activeObjectKey, body),
      env.DB.batch([
        env.DB.prepare(
          `INSERT INTO media_objects (
             id, store_id, object_key, mime_type, byte_size, status,
             created_by, created_at
           ) VALUES (?, ?, ?, 'image/png', 4, 'ACTIVE', ?, ?)`,
        ).bind(deletedMediaId, storeId, deletedObjectKey, userId, tenDaysAgo),
        env.DB.prepare(
          `INSERT INTO media_objects (
             id, store_id, object_key, mime_type, byte_size, status,
             created_by, created_at
           ) VALUES (?, ?, ?, 'image/png', 4, 'ACTIVE', ?, ?)`,
        ).bind(activeMediaId, storeId, activeObjectKey, userId, tenDaysAgo),
      ]),
    ]);

    const deleteSpy = vi.spyOn(env.MEDIA, 'delete').mockRejectedValue(new Error('R2 unavailable'));
    await expect(new MediaService(env).remove(storeId, deletedMediaId)).resolves.toEqual({
      mediaId: deletedMediaId,
      deleted: true,
    });
    await env.DB.prepare('UPDATE media_objects SET deleted_at = ? WHERE id = ?')
      .bind(tenDaysAgo, deletedMediaId)
      .run();

    await new MaintenanceService(env).runRetentionCleanup();

    expect(
      await env.DB.prepare('SELECT status FROM media_objects WHERE id = ?')
        .bind(deletedMediaId)
        .first<{ status: string }>(),
    ).toEqual({ status: 'DELETED' });
    expect(await env.MEDIA.head(deletedObjectKey)).not.toBeNull();
    expect(
      await env.DB.prepare('SELECT status FROM media_objects WHERE id = ?')
        .bind(activeMediaId)
        .first<{ status: string }>(),
    ).toEqual({ status: 'ACTIVE' });
    expect(await env.MEDIA.head(activeObjectKey)).not.toBeNull();

    deleteSpy.mockRestore();
    const retryResult = await new MaintenanceService(env).runRetentionCleanup();

    expect(retryResult.tables.media_objects).toBe(1);
    expect(
      await env.DB.prepare('SELECT id FROM media_objects WHERE id = ?')
        .bind(deletedMediaId)
        .first(),
    ).toBeNull();
    expect(await env.MEDIA.head(deletedObjectKey)).toBeNull();
    expect(await env.MEDIA.head(activeObjectKey)).not.toBeNull();
  });
});
