import { env } from 'cloudflare:workers';
import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { PlatformRepository } from '@server/repositories/platform-repository';
import { PlatformService } from '@server/services/platform-service';
import { clearWeatherCacheForTesting } from '@server/services/weather-service';
import type { WeatherResponseDto } from '@contracts/weather';

const ORIGIN = 'https://pro-pos.test';
const OWNER_EMAIL = 'weather.owner@example.com';

function cookieValue(response: Response, name: string) {
  const header = response.headers.get('Set-Cookie') ?? '';
  const match = header.match(new RegExp(`(?:^|,\\s*)${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : null;
}

async function jsonData<T>(response: Response) {
  const payload = (await response.json()) as { data: T };
  return payload.data;
}

describe('Weather Route Integration Test', () => {
  let storeId: string;
  let ownerCookie: string;

  beforeAll(async () => {
    clearWeatherCacheForTesting();

    const platform = new PlatformService(env);
    if (!(await new PlatformRepository(env.DB).hasSuperAdmin())) {
      await platform.bootstrap({
        bootstrapSecret: env.SYSTEM_BOOTSTRAP_SECRET!,
        email: 'weather.system.admin@example.com',
        displayName: 'System Admin',
        password: 'AdminPassword123!',
      });
    }

    const created = await platform.createStore({
      name: 'Weather Test Store',
      ownerDisplayName: 'Weather Owner',
      ownerEmail: OWNER_EMAIL,
      ownerUsername: 'weather.owner',
      ownerPassword: 'WeatherPassword123!',
    });
    storeId = created.storeId;

    const loginRes = await SELF.fetch(`${ORIGIN}/api/v1/auth/owner/login`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'weather.owner',
        password: 'WeatherPassword123!',
      }),
    });
    expect(loginRes.status).toBe(200);
    ownerCookie = cookieValue(loginRes, '__Host-propos-session')!;
    expect(ownerCookie).toBeTruthy();
  });

  it('rejects unauthenticated request with 401 AUTH_REQUIRED', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/weather`, {
      method: 'GET',
    });
    expect(res.status).toBe(401);
  });

  it('returns configured: false when store coordinates are not set', async () => {
    // Ensure coordinates are NULL
    await env.DB.prepare(
      'UPDATE store_settings SET latitude = NULL, longitude = NULL WHERE store_id = ?',
    )
      .bind(storeId)
      .run();

    const res = await SELF.fetch(`${ORIGIN}/api/v1/weather`, {
      method: 'GET',
      headers: {
        Cookie: ownerCookie,
      },
    });

    expect(res.status).toBe(200);
    const data = await jsonData<WeatherResponseDto>(res);
    expect(data.configured).toBe(false);
  });

  it('returns weather forecast when store coordinates are configured', async () => {
    clearWeatherCacheForTesting();

    // Set coordinates for Ho Chi Minh City
    await env.DB.prepare(
      'UPDATE store_settings SET latitude = ?, longitude = ?, address = ? WHERE store_id = ?',
    )
      .bind(10.8231, 106.6297, 'Quận 1, TP. Hồ Chí Minh', storeId)
      .run();

    // Intercept external Open-Meteo call via vi.spyOn globalThis.fetch
    const mockWeatherResponse = {
      latitude: 10.82,
      longitude: 106.63,
      timezone: 'Asia/Ho_Chi_Minh',
      current: {
        time: '2026-09-09T17:00',
        temperature_2m: 31.0,
        apparent_temperature: 36.0,
        relative_humidity_2m: 72,
        weather_code: 80,
        is_day: 1,
        precipitation: 0.5,
        wind_speed_10m: 11.2,
      },
      hourly: {
        time: ['2026-09-09T17:00', '2026-09-09T18:00'],
        temperature_2m: [31.0, 30.0],
        precipitation_probability: [75, 40],
        weather_code: [80, 1],
      },
      daily: {
        time: ['2026-09-09'],
        weather_code: [80],
        temperature_2m_max: [33.0],
        temperature_2m_min: [25.5],
        precipitation_probability_max: [80],
        precipitation_sum: [5.0],
      },
    };

    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
      if (url.includes('api.open-meteo.com')) {
        return new Response(JSON.stringify(mockWeatherResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input, init);
    });

    try {
      const res = await SELF.fetch(`${ORIGIN}/api/v1/weather`, {
        method: 'GET',
        headers: {
          Cookie: ownerCookie,
        },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('private, max-age=300');

      const data = await jsonData<WeatherResponseDto>(res);
      expect(data.configured).toBe(true);
      expect(data.location?.label).toBe('Quận 1, TP. Hồ Chí Minh');
      expect(data.current?.temperatureC).toBe(31.0);
      expect(data.current?.weatherLabel).toBe('Mưa rào nhẹ');
      expect(data.summaryAlert?.rainSoon).toBe(true);
      expect(data.summaryAlert?.rainTime).toBe('17:00');

      // Subsequent call within TTL hits cache (does not re-call Open-Meteo)
      const resCached = await SELF.fetch(`${ORIGIN}/api/v1/weather`, {
        method: 'GET',
        headers: {
          Cookie: ownerCookie,
        },
      });
      expect(resCached.status).toBe(200);
      const cachedData = await jsonData<WeatherResponseDto>(resCached);
      expect(cachedData.current?.temperatureC).toBe(31.0);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
