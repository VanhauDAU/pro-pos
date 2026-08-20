import { AppError } from '@server/lib/app-error';
import { MediaRepository } from '@server/repositories/media-repository';
import { AuditRepository, type AuditContext } from '@server/repositories/audit-repository';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function detectImage(bytes: Uint8Array) {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { mimeType: 'image/png' as const, extension: 'png' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: 'image/jpeg' as const, extension: 'jpg' };
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    return { mimeType: 'image/webp' as const, extension: 'webp' };
  }
  throw new AppError('MEDIA_TYPE_NOT_ALLOWED', 'Chỉ hỗ trợ PNG, JPEG hoặc WebP.', 422);
}

export class MediaService {
  private readonly repository: MediaRepository;

  constructor(private readonly env: CloudflareBindings) {
    this.repository = new MediaRepository(env.DB);
  }

  async upload(input: {
    storeId: string;
    actorId: string;
    file: File;
    auditContext?: AuditContext;
  }) {
    if (input.file.size <= 0 || input.file.size > MAX_IMAGE_BYTES) {
      throw new AppError('MEDIA_SIZE_INVALID', 'Ảnh phải có dung lượng từ 1 byte đến 5 MB.', 422);
    }
    const body = new Uint8Array(await input.file.arrayBuffer());
    const detected = detectImage(body);
    const id = crypto.randomUUID();
    const objectKey = `stores/${input.storeId}/media/${id}.${detected.extension}`;
    await this.env.MEDIA.put(objectKey, body, {
      httpMetadata: { contentType: detected.mimeType },
      customMetadata: { storeId: input.storeId, mediaId: id },
    });
    try {
      await this.repository.create({
        id,
        storeId: input.storeId,
        objectKey,
        mimeType: detected.mimeType,
        byteSize: body.byteLength,
        actorId: input.actorId,
        now: Date.now(),
      });
    } catch (error) {
      await this.env.MEDIA.delete(objectKey);
      throw error;
    }
    const result = { id, mimeType: detected.mimeType, byteSize: body.byteLength };
    if (input.auditContext) {
      await new AuditRepository(this.env.DB).record({
        storeId: input.storeId,
        context: input.auditContext,
        action: 'MEDIA_UPLOADED',
        entityType: 'MEDIA',
        entityId: id,
        before: null,
        after: result,
        now: Date.now(),
      });
    }
    return result;
  }

  async get(storeId: string, mediaId: string) {
    const media = await this.repository.find(storeId, mediaId);
    if (!media || media.status !== 'ACTIVE') {
      throw new AppError('MEDIA_NOT_FOUND', 'Không tìm thấy ảnh.', 404);
    }
    const object = await this.env.MEDIA.get(media.object_key);
    if (!object) throw new AppError('MEDIA_NOT_FOUND', 'Không tìm thấy ảnh.', 404);
    return { media, object };
  }

  async remove(storeId: string, mediaId: string, auditContext?: AuditContext) {
    const media = await this.repository.find(storeId, mediaId);
    if (!media || media.status !== 'ACTIVE') {
      throw new AppError('MEDIA_NOT_FOUND', 'Không tìm thấy ảnh.', 404);
    }
    await this.repository.markDeleted(storeId, mediaId, Date.now());
    const result = { mediaId, deleted: true };
    if (auditContext) {
      await new AuditRepository(this.env.DB).record({
        storeId,
        context: auditContext,
        action: 'MEDIA_DELETED',
        entityType: 'MEDIA',
        entityId: mediaId,
        before: media,
        after: result,
        now: Date.now(),
      });
    }
    return result;
  }
}
