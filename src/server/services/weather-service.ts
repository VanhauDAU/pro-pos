import type { WeatherLocationDto, WeatherResponseDto } from '@contracts/weather';
import { AppError } from '@server/lib/app-error';
import { StoreRepository } from '@server/repositories/store-repository';
import { OpenMeteoClient } from '@server/integrations/weather/open-meteo-client';
import { mapOpenMeteoResponse } from '@server/integrations/weather/weather-mapper';

interface CachedWeather {
  data: WeatherResponseDto;
  expiresAt: number;
  cachedAt: number;
}

// Module-level cache and inflight promises shared across requests in the worker isolate.
const weatherCache = new Map<string, CachedWeather>();
const inflightRequests = new Map<string, Promise<WeatherResponseDto>>();

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const STALE_GRACE_MS = 60 * 60 * 1000; // 60 minutes

export function clearWeatherCacheForTesting() {
  weatherCache.clear();
  inflightRequests.clear();
}

export class WeatherService {
  private readonly storeRepository: StoreRepository;
  private readonly openMeteoClient: OpenMeteoClient;

  constructor(
    private readonly env: CloudflareBindings,
    client?: OpenMeteoClient,
  ) {
    this.storeRepository = new StoreRepository(env.DB);
    this.openMeteoClient =
      client ??
      new OpenMeteoClient({
        baseUrl: (env as unknown as { OPEN_METEO_BASE_URL?: string }).OPEN_METEO_BASE_URL,
        apiKey: (env as unknown as { OPEN_METEO_API_KEY?: string }).OPEN_METEO_API_KEY,
        timeoutMs: 5000,
      });
  }

  async getStoreWeather(storeId: string): Promise<WeatherResponseDto> {
    const settings = await this.storeRepository.getSettings(storeId);
    if (!settings || settings.latitude === null || settings.longitude === null) {
      return { configured: false };
    }

    const { latitude, longitude, address } = settings;

    // Validate coordinates range
    if (
      typeof latitude !== 'number' ||
      typeof longitude !== 'number' ||
      Number.isNaN(latitude) ||
      Number.isNaN(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return { configured: false };
    }

    const storeLocation: WeatherLocationDto = {
      latitude,
      longitude,
      label: address ?? null,
    };

    const cacheKey = `${storeId}:${latitude.toFixed(4)}:${longitude.toFixed(4)}`;
    const now = Date.now();

    const cached = weatherCache.get(cacheKey);
    if (cached && now < cached.expiresAt) {
      return cached.data;
    }

    // Deduplicate in-flight requests for the same cache key
    const existingInflight = inflightRequests.get(cacheKey);
    if (existingInflight) {
      return existingInflight;
    }

    const fetchPromise = (async () => {
      try {
        const raw = await this.openMeteoClient.fetchForecast({ latitude, longitude });
        const mapped = mapOpenMeteoResponse(raw, storeLocation, Date.now());

        weatherCache.set(cacheKey, {
          data: mapped,
          expiresAt: Date.now() + CACHE_TTL_MS,
          cachedAt: Date.now(),
        });

        return mapped;
      } catch (err: unknown) {
        // Fallback: If stale cache exists within grace period, return it with isStale: true
        if (cached && Date.now() - cached.cachedAt < STALE_GRACE_MS) {
          return {
            ...cached.data,
            isStale: true,
          };
        }

        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          JSON.stringify({
            level: 'warn',
            message: 'failed to fetch weather from Open-Meteo',
            storeId,
            error: message,
          }),
        );

        throw new AppError(
          'WEATHER_UNAVAILABLE',
          `Không thể tải thông tin thời tiết lúc này: ${message}`,
          502,
        );
      } finally {
        inflightRequests.delete(cacheKey);
      }
    })();

    inflightRequests.set(cacheKey, fetchPromise);
    return fetchPromise;
  }
}
