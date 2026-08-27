import { Hono } from 'hono';

import { AppError } from '@server/lib/app-error';
import { success } from '@server/lib/response';
import { requireActor, requirePermission } from '@server/middleware/authorization';
import { MediaService } from '@server/services/media-service';
import type { AppEnv } from '@server/types';

const mediaRoutes = new Hono<AppEnv>();
mediaRoutes.use('*', requireActor('OWNER', 'EMPLOYEE'));

mediaRoutes.get('/:mediaId', async (c) => {
  const storeId = c.get('actor').storeId!;
  const result = await new MediaService(c.env).get(storeId, c.req.param('mediaId'));
  const headers = new Headers();
  result.object.writeHttpMetadata(headers);
  headers.set('ETag', result.object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  return new Response(result.object.body, { headers });
});

mediaRoutes.post('/fetch-url', requirePermission('catalog.manage'), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { url?: unknown };
  if (!body.url || typeof body.url !== 'string') {
    throw new AppError('MEDIA_URL_INVALID', 'Vui lòng cung cấp đường dẫn ảnh hợp lệ.', 400);
  }
  return success(c, await new MediaService(c.env).fetchFromUrl(body.url));
});

mediaRoutes.post('/', requirePermission('catalog.manage'), async (c) => {
  const contentLength = Number(c.req.header('Content-Length') ?? 0);
  if (contentLength > 6 * 1024 * 1024) {
    throw new AppError('MEDIA_SIZE_INVALID', 'Ảnh vượt quá giới hạn 5 MB.', 422);
  }
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    throw new AppError('MEDIA_FILE_REQUIRED', 'Thiếu file ảnh.', 422);
  }
  const actor = c.get('actor');
  return success(
    c,
    await new MediaService(c.env).upload({
      storeId: actor.storeId!,
      actorId: actor.id,
      file,
      auditContext: {
        actorUserId: actor.id,
        actorSessionId: c.get('sessionId'),
        deviceId: c.get('device')?.id ?? null,
        requestId: c.get('requestId'),
      },
    }),
    201,
  );
});

mediaRoutes.delete('/:mediaId', requirePermission('catalog.manage'), async (c) =>
  success(
    c,
    await new MediaService(c.env).remove(c.get('actor').storeId!, c.req.param('mediaId'), {
      actorUserId: c.get('actor').id,
      actorSessionId: c.get('sessionId'),
      deviceId: c.get('device')?.id ?? null,
      requestId: c.get('requestId'),
    }),
  ),
);

export { mediaRoutes };
