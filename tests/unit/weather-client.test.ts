import { describe, expect, it, vi } from 'vitest';
import { OpenMeteoClient, OpenMeteoError } from '@server/integrations/weather/open-meteo-client';

describe('OpenMeteoClient', () => {
  it('constructs correct query URL with required forecast parameters', async () => {
    let requestedUrl = '';
    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      requestedUrl = url.toString();
      return new Response(
        JSON.stringify({
          latitude: 10.82,
          longitude: 106.63,
          timezone: 'Asia/Ho_Chi_Minh',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const client = new OpenMeteoClient({
      baseUrl: 'https://custom-api.open-meteo.com',
      apiKey: 'test-api-key',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await client.fetchForecast({ latitude: 10.82, longitude: 106.63 });

    const url = new URL(requestedUrl);
    expect(url.origin).toBe('https://custom-api.open-meteo.com');
    expect(url.pathname).toBe('/v1/forecast');
    expect(url.searchParams.get('latitude')).toBe('10.82');
    expect(url.searchParams.get('longitude')).toBe('106.63');
    expect(url.searchParams.get('timezone')).toBe('auto');
    expect(url.searchParams.get('forecast_hours')).toBe('12');
    expect(url.searchParams.get('forecast_days')).toBe('3');
    expect(url.searchParams.get('apikey')).toBe('test-api-key');
    expect(url.searchParams.get('current')).toContain('temperature_2m');
    expect(url.searchParams.get('hourly')).toContain('precipitation_probability');
    expect(url.searchParams.get('daily')).toContain('precipitation_sum');
  });

  it('throws OpenMeteoError with code HTTP_ERROR on 5xx or 4xx status', async () => {
    const mockFetch = vi.fn(async () => {
      return new Response('Internal Server Error', { status: 500 });
    });

    const client = new OpenMeteoClient({
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await expect(client.fetchForecast({ latitude: 10.82, longitude: 106.63 })).rejects.toThrow(
      OpenMeteoError,
    );

    try {
      await client.fetchForecast({ latitude: 10.82, longitude: 106.63 });
    } catch (err: any) {
      expect(err.code).toBe('HTTP_ERROR');
      expect(err.status).toBe(500);
    }
  });

  it('throws OpenMeteoError with code NETWORK_ERROR on fetch exception', async () => {
    const mockFetch = vi.fn(async () => {
      throw new Error('Connection refused');
    });

    const client = new OpenMeteoClient({
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    try {
      await client.fetchForecast({ latitude: 10.82, longitude: 106.63 });
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(OpenMeteoError);
      expect(err.code).toBe('NETWORK_ERROR');
    }
  });

  it('throws OpenMeteoError with code INVALID_RESPONSE on invalid JSON body', async () => {
    const mockFetch = vi.fn(async () => {
      return new Response('Not valid JSON', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new OpenMeteoClient({
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    try {
      await client.fetchForecast({ latitude: 10.82, longitude: 106.63 });
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(OpenMeteoError);
      expect(err.code).toBe('INVALID_RESPONSE');
    }
  });
});
