import { AppError } from '@server/lib/app-error';
import { MediaRepository } from '@server/repositories/media-repository';
import { AuditRepository, type AuditContext } from '@server/repositories/audit-repository';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function detectMimeTypeForUrl(bytes: Uint8Array, headerContentType?: string | null): string {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'image/gif';
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return 'image/bmp';
  }
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp') {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (['avif', 'avis', 'mif1', 'msf1'].includes(brand)) {
      return 'image/avif';
    }
  }
  if (headerContentType && headerContentType.toLowerCase().startsWith('image/')) {
    return headerContentType.toLowerCase().split(';')[0]!.trim();
  }
  throw new AppError(
    'MEDIA_TYPE_NOT_ALLOWED',
    'Định dạng ảnh không được hỗ trợ hoặc tệp tải về không phải là ảnh.',
    422,
  );
}

function isPrivateIpOrHost(hostname: string): boolean {
  const host = hostname.toLowerCase().trim();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost')
  ) {
    return true;
  }
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = ipv4Regex.exec(host);
  if (match) {
    const octet1 = parseInt(match[1]!, 10);
    const octet2 = parseInt(match[2]!, 10);
    if (octet1 === 10) return true;
    if (octet1 === 127) return true;
    if (octet1 === 169 && octet2 === 254) return true;
    if (octet1 === 192 && octet2 === 168) return true;
    if (octet1 === 172 && octet2 >= 16 && octet2 <= 31) return true;
    if (octet1 === 0) return true;
  }
  return false;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

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

  async fetchFromUrl(rawUrl: string) {
    const trimmed = rawUrl.trim();
    if (!trimmed) {
      throw new AppError('MEDIA_URL_INVALID', 'Vui lòng cung cấp đường dẫn ảnh.', 400);
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(trimmed);
    } catch {
      throw new AppError('MEDIA_URL_INVALID', 'Đường dẫn URL không hợp lệ.', 400);
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new AppError('MEDIA_URL_INVALID', 'Chỉ hỗ trợ đường dẫn http hoặc https.', 400);
    }
    if (isPrivateIpOrHost(parsedUrl.hostname)) {
      throw new AppError('MEDIA_URL_INVALID', 'Địa chỉ máy chủ không được phép truy cập.', 400);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    let response: Response;
    try {
      response = await fetch(parsedUrl.toString(), {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        },
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new AppError(
          'MEDIA_FETCH_TIMEOUT',
          'Tải ảnh từ URL quá thời gian (10 giây). Vui lòng thử lại.',
          408,
        );
      }
      throw new AppError(
        'MEDIA_FETCH_FAILED',
        'Không thể kết nối đến máy chủ chứa ảnh. Vui lòng kiểm tra lại đường dẫn.',
        502,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new AppError(
        'MEDIA_FETCH_FAILED',
        `Không thể tải ảnh từ URL (Mã lỗi ${response.status}: ${response.statusText}).`,
        422,
      );
    }

    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > 10 * 1024 * 1024) {
      throw new AppError('MEDIA_SIZE_INVALID', 'Dung lượng ảnh vượt quá giới hạn 10 MB.', 422);
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength <= 0 || arrayBuffer.byteLength > 10 * 1024 * 1024) {
      throw new AppError('MEDIA_SIZE_INVALID', 'Ảnh tải về không hợp lệ hoặc vượt quá 10 MB.', 422);
    }

    const bytes = new Uint8Array(arrayBuffer);
    const mimeType = detectMimeTypeForUrl(bytes, response.headers.get('content-type'));
    const base64 = uint8ArrayToBase64(bytes);
    const dataUrl = `data:${mimeType};base64,${base64}`;

    return {
      dataUrl,
      mimeType,
      byteSize: bytes.byteLength,
    };
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
    await this.env.MEDIA.delete(media.object_key).catch(() => {});
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
