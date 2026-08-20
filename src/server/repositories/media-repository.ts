export interface MediaRow {
  id: string;
  store_id: string;
  object_key: string;
  mime_type: 'image/png' | 'image/jpeg' | 'image/webp';
  byte_size: number;
  status: 'ACTIVE' | 'DELETED';
}

export class MediaRepository {
  constructor(private readonly db: D1Database) {}

  async create(input: {
    id: string;
    storeId: string;
    objectKey: string;
    mimeType: string;
    byteSize: number;
    actorId: string;
    now: number;
  }) {
    await this.db
      .prepare(
        `INSERT INTO media_objects (
          id, store_id, object_key, mime_type, byte_size, status,
          created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
      )
      .bind(
        input.id,
        input.storeId,
        input.objectKey,
        input.mimeType,
        input.byteSize,
        input.actorId,
        input.now,
      )
      .run();
  }

  find(storeId: string, mediaId: string) {
    return this.db
      .prepare(
        `SELECT id, store_id, object_key, mime_type, byte_size, status
         FROM media_objects WHERE id = ? AND store_id = ? LIMIT 1`,
      )
      .bind(mediaId, storeId)
      .first<MediaRow>();
  }

  async markDeleted(storeId: string, mediaId: string, now: number) {
    return this.db
      .prepare(
        `UPDATE media_objects SET status = 'DELETED', deleted_at = ?
         WHERE id = ? AND store_id = ? AND status = 'ACTIVE'`,
      )
      .bind(now, mediaId, storeId)
      .run();
  }
}
