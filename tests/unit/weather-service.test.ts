import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@server/lib/app-error';
import {
  OpenMeteoClient,
  type RawOpenMeteoResponse,
} from '@server/integrations/weather/open-meteo-client';
import { clearWeatherCacheForTesting, WeatherService } from '@server/services/weather-service';
import { StoreRepository } from '@server/repositories/store-repository';

describe('WeatherService', () => {
  const fakeStoreId = 'store-weather-unit-test-123';

  const sampleRaw: RawOpenMeteoResponse = {
    latitude: 10.82,
    longitude: 106.63,
    timezone: 'Asia/Ho_Chi_Minh',
    current: {
      time: '2026-09-09T17:00',
      temperature_2m: 30.0,
      apparent_temperature: 34.5,
      relative_humidity_2m: 70,
      weather_code: 1,
      is_day: 1,
      precipitation: 0,
      wind_speed_10m: 10.0,
    },
    hourly: {
      time: ['2026-09-09T17:00', '2026-09-09T18:00'],
      temperature_2m: [30.0, 29.0],
      precipitation_probability: [10, 15],
      weather_code: [1, 2],
    },
    daily: {
      time: ['2026-09-09'],
      weather_code: [1],
      temperature_2m_max: [33.0],
      temperature_2m_min: [25.0],
      precipitation_probability_max: [20],
      precipitation_sum: [0],
    },
  };

  beforeEach(() => {
    clearWeatherCacheForTesting();
    vi.restoreAllMocks();
  });

  it('returns configured: false when store does not have coordinates', async () => {
    vi.spyOn(StoreRepository.prototype, 'getSettings').mockResolvedValue({
      id: fakeStoreId,
      name: 'Test Store',
      status: 'ACTIVE',
      timezone: 'Asia/Ho_Chi_Minh',
      phone: null,
      address: null,
      currency: 'VND',
      businessDayCutoffMinutes: 0,
      employeeRememberSessionHours: 24,
      bankName: null,
      bankAccountNumber: null,
      bankAccountName: null,
      bankQrMediaId: null,
      provinceCode: null,
      provinceName: null,
      wardCode: null,
      wardName: null,
      locationVerificationEnabled: 0,
      latitude: null,
      longitude: null,
      allowedRadiusMeters: 300,
      maxAccuracyMeters: 100,
    });

    const mockClient = {
      fetchForecast: vi.fn(),
    } as unknown as OpenMeteoClient;

    const service = new WeatherService({} as any, mockClient);
    const result = await service.getStoreWeather(fakeStoreId);

    expect(result.configured).toBe(false);
    expect(mockClient.fetchForecast).not.toHaveBeenCalled();
  });

  it('returns configured: false when coordinates are out of bounds', async () => {
    vi.spyOn(StoreRepository.prototype, 'getSettings').mockResolvedValue({
      id: fakeStoreId,
      name: 'Test Store',
      status: 'ACTIVE',
      timezone: 'Asia/Ho_Chi_Minh',
      phone: null,
      address: null,
      currency: 'VND',
      businessDayCutoffMinutes: 0,
      employeeRememberSessionHours: 24,
      bankName: null,
      bankAccountNumber: null,
      bankAccountName: null,
      bankQrMediaId: null,
      provinceCode: null,
      provinceName: null,
      wardCode: null,
      wardName: null,
      locationVerificationEnabled: 0,
      latitude: 95.0, // invalid latitude > 90
      longitude: 106.63,
      allowedRadiusMeters: 300,
      maxAccuracyMeters: 100,
    });

    const mockClient = {
      fetchForecast: vi.fn(),
    } as unknown as OpenMeteoClient;

    const service = new WeatherService({} as any, mockClient);
    const result = await service.getStoreWeather(fakeStoreId);

    expect(result.configured).toBe(false);
    expect(mockClient.fetchForecast).not.toHaveBeenCalled();
  });

  it('fetches and returns weather data when store has valid coordinates', async () => {
    vi.spyOn(StoreRepository.prototype, 'getSettings').mockResolvedValue({
      id: fakeStoreId,
      name: 'Test Store',
      status: 'ACTIVE',
      timezone: 'Asia/Ho_Chi_Minh',
      phone: null,
      address: '123 Đường Pasteur',
      currency: 'VND',
      businessDayCutoffMinutes: 0,
      employeeRememberSessionHours: 24,
      bankName: null,
      bankAccountNumber: null,
      bankAccountName: null,
      bankQrMediaId: null,
      provinceCode: null,
      provinceName: null,
      wardCode: null,
      wardName: null,
      locationVerificationEnabled: 1,
      latitude: 10.782,
      longitude: 106.698,
      allowedRadiusMeters: 300,
      maxAccuracyMeters: 100,
    });

    const mockClient = {
      fetchForecast: vi.fn().mockResolvedValue(sampleRaw),
    } as unknown as OpenMeteoClient;

    const service = new WeatherService({} as any, mockClient);
    const result = await service.getStoreWeather(fakeStoreId);

    expect(result.configured).toBe(true);
    expect(result.current?.temperatureC).toBe(30.0);
    expect(result.location?.label).toBe('123 Đường Pasteur');
    expect(mockClient.fetchForecast).toHaveBeenCalledTimes(1);
    expect(mockClient.fetchForecast).toHaveBeenCalledWith({
      latitude: 10.782,
      longitude: 106.698,
    });
  });

  it('serves subsequent requests from cache without calling client again', async () => {
    vi.spyOn(StoreRepository.prototype, 'getSettings').mockResolvedValue({
      id: fakeStoreId,
      name: 'Test Store',
      status: 'ACTIVE',
      timezone: 'Asia/Ho_Chi_Minh',
      phone: null,
      address: null,
      currency: 'VND',
      businessDayCutoffMinutes: 0,
      employeeRememberSessionHours: 24,
      bankName: null,
      bankAccountNumber: null,
      bankAccountName: null,
      bankQrMediaId: null,
      provinceCode: null,
      provinceName: null,
      wardCode: null,
      wardName: null,
      locationVerificationEnabled: 1,
      latitude: 10.782,
      longitude: 106.698,
      allowedRadiusMeters: 300,
      maxAccuracyMeters: 100,
    });

    const mockClient = {
      fetchForecast: vi.fn().mockResolvedValue(sampleRaw),
    } as unknown as OpenMeteoClient;

    const service = new WeatherService({} as any, mockClient);

    const first = await service.getStoreWeather(fakeStoreId);
    const second = await service.getStoreWeather(fakeStoreId);

    expect(first).toEqual(second);
    expect(mockClient.fetchForecast).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent in-flight requests', async () => {
    vi.spyOn(StoreRepository.prototype, 'getSettings').mockResolvedValue({
      id: fakeStoreId,
      name: 'Test Store',
      status: 'ACTIVE',
      timezone: 'Asia/Ho_Chi_Minh',
      phone: null,
      address: null,
      currency: 'VND',
      businessDayCutoffMinutes: 0,
      employeeRememberSessionHours: 24,
      bankName: null,
      bankAccountNumber: null,
      bankAccountName: null,
      bankQrMediaId: null,
      provinceCode: null,
      provinceName: null,
      wardCode: null,
      wardName: null,
      locationVerificationEnabled: 1,
      latitude: 10.782,
      longitude: 106.698,
      allowedRadiusMeters: 300,
      maxAccuracyMeters: 100,
    });

    let resolvePromise: (val: any) => void;
    const delayedPromise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    const mockClient = {
      fetchForecast: vi.fn().mockReturnValue(delayedPromise),
    } as unknown as OpenMeteoClient;

    const service = new WeatherService({} as any, mockClient);

    const call1 = service.getStoreWeather(fakeStoreId);
    const call2 = service.getStoreWeather(fakeStoreId);
    const call3 = service.getStoreWeather(fakeStoreId);

    resolvePromise!(sampleRaw);

    const [res1, res2, res3] = await Promise.all([call1, call2, call3]);

    expect(res1.current?.temperatureC).toBe(30.0);
    expect(res2.current?.temperatureC).toBe(30.0);
    expect(res3.current?.temperatureC).toBe(30.0);
    expect(mockClient.fetchForecast).toHaveBeenCalledTimes(1);
  });

  it('invalidates cache when store location coordinates change', async () => {
    const getSettingsSpy = vi.spyOn(StoreRepository.prototype, 'getSettings');

    getSettingsSpy.mockResolvedValueOnce({
      id: fakeStoreId,
      name: 'Test Store',
      status: 'ACTIVE',
      timezone: 'Asia/Ho_Chi_Minh',
      phone: null,
      address: null,
      currency: 'VND',
      businessDayCutoffMinutes: 0,
      employeeRememberSessionHours: 24,
      bankName: null,
      bankAccountNumber: null,
      bankAccountName: null,
      bankQrMediaId: null,
      provinceCode: null,
      provinceName: null,
      wardCode: null,
      wardName: null,
      locationVerificationEnabled: 1,
      latitude: 10.782,
      longitude: 106.698,
      allowedRadiusMeters: 300,
      maxAccuracyMeters: 100,
    });

    const mockClient = {
      fetchForecast: vi.fn().mockResolvedValue(sampleRaw),
    } as unknown as OpenMeteoClient;

    const service = new WeatherService({} as any, mockClient);

    // Call with first location
    await service.getStoreWeather(fakeStoreId);
    expect(mockClient.fetchForecast).toHaveBeenCalledTimes(1);

    // Store moves to new location
    getSettingsSpy.mockResolvedValueOnce({
      id: fakeStoreId,
      name: 'Test Store',
      status: 'ACTIVE',
      timezone: 'Asia/Ho_Chi_Minh',
      phone: null,
      address: null,
      currency: 'VND',
      businessDayCutoffMinutes: 0,
      employeeRememberSessionHours: 24,
      bankName: null,
      bankAccountNumber: null,
      bankAccountName: null,
      bankQrMediaId: null,
      provinceCode: null,
      provinceName: null,
      wardCode: null,
      wardName: null,
      locationVerificationEnabled: 1,
      latitude: 21.0285, // Hanoi coords
      longitude: 105.8542,
      allowedRadiusMeters: 300,
      maxAccuracyMeters: 100,
    });

    await service.getStoreWeather(fakeStoreId);
    expect(mockClient.fetchForecast).toHaveBeenCalledTimes(2);
    expect(mockClient.fetchForecast).toHaveBeenLastCalledWith({
      latitude: 21.0285,
      longitude: 105.8542,
    });
  });

  it('falls back to stale cached data with isStale: true if fetch fails', async () => {
    vi.spyOn(StoreRepository.prototype, 'getSettings').mockResolvedValue({
      id: fakeStoreId,
      name: 'Test Store',
      status: 'ACTIVE',
      timezone: 'Asia/Ho_Chi_Minh',
      phone: null,
      address: null,
      currency: 'VND',
      businessDayCutoffMinutes: 0,
      employeeRememberSessionHours: 24,
      bankName: null,
      bankAccountNumber: null,
      bankAccountName: null,
      bankQrMediaId: null,
      provinceCode: null,
      provinceName: null,
      wardCode: null,
      wardName: null,
      locationVerificationEnabled: 1,
      latitude: 10.782,
      longitude: 106.698,
      allowedRadiusMeters: 300,
      maxAccuracyMeters: 100,
    });

    const mockClient = {
      fetchForecast: vi
        .fn()
        .mockResolvedValueOnce(sampleRaw)
        .mockRejectedValueOnce(new Error('Open-Meteo downtime')),
    } as unknown as OpenMeteoClient;

    const service = new WeatherService({} as any, mockClient);

    // Initial successful fetch
    const first = await service.getStoreWeather(fakeStoreId);
    expect(first.isStale).toBeFalsy();

    // Advance time past 15m TTL (e.g. 20m)
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 20 * 60 * 1000);

    // Next fetch fails, should return cached data with isStale: true
    const second = await service.getStoreWeather(fakeStoreId);
    expect(second.isStale).toBe(true);
    expect(second.current?.temperatureC).toBe(30.0);
  });

  it('throws AppError 502 when Open-Meteo fails and no cache exists', async () => {
    vi.spyOn(StoreRepository.prototype, 'getSettings').mockResolvedValue({
      id: fakeStoreId,
      name: 'Test Store',
      status: 'ACTIVE',
      timezone: 'Asia/Ho_Chi_Minh',
      phone: null,
      address: null,
      currency: 'VND',
      businessDayCutoffMinutes: 0,
      employeeRememberSessionHours: 24,
      bankName: null,
      bankAccountNumber: null,
      bankAccountName: null,
      bankQrMediaId: null,
      provinceCode: null,
      provinceName: null,
      wardCode: null,
      wardName: null,
      locationVerificationEnabled: 1,
      latitude: 10.782,
      longitude: 106.698,
      allowedRadiusMeters: 300,
      maxAccuracyMeters: 100,
    });

    const mockClient = {
      fetchForecast: vi.fn().mockRejectedValue(new Error('Network error')),
    } as unknown as OpenMeteoClient;

    const service = new WeatherService({} as any, mockClient);

    await expect(service.getStoreWeather(fakeStoreId)).rejects.toThrow(AppError);
    try {
      await service.getStoreWeather(fakeStoreId);
    } catch (err: any) {
      expect(err.code).toBe('WEATHER_UNAVAILABLE');
      expect(err.status).toBe(502);
    }
  });
});
