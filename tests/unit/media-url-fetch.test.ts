import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../src/server/lib/app-error';
import { MediaService } from '../../src/server/services/media-service';

describe('MediaService.fetchFromUrl', () => {
  const mockEnv = {
    DB: {} as any,
    MEDIA: {} as any,
  } as CloudflareBindings;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects empty or invalid URL strings', async () => {
    const service = new MediaService(mockEnv);
    await expect(service.fetchFromUrl('')).rejects.toThrowError(AppError);
    await expect(service.fetchFromUrl('   ')).rejects.toThrowError(AppError);
    await expect(service.fetchFromUrl('not-a-url')).rejects.toThrowError(AppError);
  });

  it('rejects non-http/https protocols', async () => {
    const service = new MediaService(mockEnv);
    await expect(service.fetchFromUrl('ftp://example.com/test.png')).rejects.toThrowError(
      /Chỉ hỗ trợ đường dẫn http hoặc https/,
    );
    await expect(service.fetchFromUrl('file:///etc/passwd')).rejects.toThrowError(
      /Chỉ hỗ trợ đường dẫn http hoặc https/,
    );
  });

  it('blocks private and loopback IP addresses (SSRF protection)', async () => {
    const service = new MediaService(mockEnv);
    await expect(service.fetchFromUrl('http://localhost/test.png')).rejects.toThrowError(
      /Địa chỉ máy chủ không được phép truy cập/,
    );
    await expect(service.fetchFromUrl('http://127.0.0.1:8080/image.jpg')).rejects.toThrowError(
      /Địa chỉ máy chủ không được phép truy cập/,
    );
    await expect(service.fetchFromUrl('http://10.0.0.5/image.png')).rejects.toThrowError(
      /Địa chỉ máy chủ không được phép truy cập/,
    );
    await expect(service.fetchFromUrl('http://192.168.1.100/image.png')).rejects.toThrowError(
      /Địa chỉ máy chủ không được phép truy cập/,
    );
    await expect(service.fetchFromUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrowError(
      /Địa chỉ máy chủ không được phép truy cập/,
    );
  });

  it('successfully fetches image and converts to Data URL', async () => {
    const service = new MediaService(mockEnv);

    // 1x1 PNG transparent pixel
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
      0x15, 0xc4, 0x89,
    ]);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(pngBytes, {
        status: 200,
        headers: { 'Content-Type': 'image/png', 'Content-Length': String(pngBytes.byteLength) },
      }),
    );

    const result = await service.fetchFromUrl('https://images.unsplash.com/photo-sample.png');

    expect(result.mimeType).toBe('image/png');
    expect(result.byteSize).toBe(pngBytes.byteLength);
    expect(result.dataUrl).toContain('data:image/png;base64,');
  });

  it('detects JPEG and WEBP images properly', async () => {
    const service = new MediaService(mockEnv);

    // JPEG header: FF D8 FF
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(jpegBytes, {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      }),
    );

    const jpegResult = await service.fetchFromUrl('https://example.com/product.jpg');
    expect(jpegResult.mimeType).toBe('image/jpeg');
    expect(jpegResult.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);

    // WEBP header: RIFF....WEBP
    const webpBytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(webpBytes, {
        status: 200,
        headers: { 'Content-Type': 'image/webp' },
      }),
    );

    const webpResult = await service.fetchFromUrl('https://example.com/product.webp');
    expect(webpResult.mimeType).toBe('image/webp');
    expect(webpResult.dataUrl.startsWith('data:image/webp;base64,')).toBe(true);
  });

  it('rejects non-image responses or unallowed content types', async () => {
    const service = new MediaService(mockEnv);
    const htmlBytes = new TextEncoder().encode('<!DOCTYPE html><html><body>Error</body></html>');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(htmlBytes, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    );

    await expect(
      service.fetchFromUrl('https://example.com/page.html'),
    ).rejects.toThrowError(/Định dạng ảnh không được hỗ trợ/);
  });

  it('handles HTTP error status from remote host', async () => {
    const service = new MediaService(mockEnv);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Not Found', {
        status: 404,
        statusText: 'Not Found',
      }),
    );

    await expect(
      service.fetchFromUrl('https://example.com/non-existent.jpg'),
    ).rejects.toThrowError(/Không thể tải ảnh từ URL \(Mã lỗi 404/);
  });
});
