import { Hono } from 'hono';

import { AppError } from '@server/lib/app-error';
import { success } from '@server/lib/response';
import { requireActor } from '@server/middleware/authorization';
import { WeatherService } from '@server/services/weather-service';
import type { AppEnv } from '@server/types';

export const weatherRoutes = new Hono<AppEnv>();

weatherRoutes.use('*', requireActor('OWNER', 'EMPLOYEE'));

weatherRoutes.get('/', async (c) => {
  const actor = c.get('actor');
  if (!actor?.storeId) {
    throw new AppError('STORE_REQUIRED', 'Không tìm thấy thông tin cửa hàng.', 400);
  }

  const service = new WeatherService(c.env);
  const data = await service.getStoreWeather(actor.storeId);

  if (!data.configured) {
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate');
  } else {
    c.header('Cache-Control', 'private, max-age=300');
  }
  return success(c, data);
});
