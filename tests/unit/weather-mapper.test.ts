import { describe, expect, it } from 'vitest';
import type { RawOpenMeteoResponse } from '@server/integrations/weather/open-meteo-client';
import { deriveRainAlert, mapOpenMeteoResponse } from '@server/integrations/weather/weather-mapper';

describe('Weather Mapper', () => {
  const sampleLocation = {
    latitude: 10.8231,
    longitude: 106.6297,
    label: '123 Đường Nguyễn Huệ, Q.1',
  };

  const sampleRawResponse: RawOpenMeteoResponse = {
    latitude: 10.82,
    longitude: 106.63,
    timezone: 'Asia/Ho_Chi_Minh',
    current: {
      time: '2026-09-09T17:00',
      temperature_2m: 31.42,
      apparent_temperature: 36.18,
      relative_humidity_2m: 72.3,
      weather_code: 80,
      is_day: 1,
      precipitation: 1.25,
      wind_speed_10m: 12.48,
    },
    hourly: {
      time: ['2026-09-09T17:00', '2026-09-09T18:00', '2026-09-09T19:00', '2026-09-09T20:00'],
      temperature_2m: [31.4, 30.1, 28.5, 27.2],
      precipitation_probability: [75, 40, 20, 10],
      weather_code: [80, 61, 3, 2],
    },
    daily: {
      time: ['2026-09-09', '2026-09-10', '2026-09-11'],
      weather_code: [80, 61, 1],
      temperature_2m_max: [33.51, 32.8, 31.9],
      temperature_2m_min: [25.79, 25.4, 24.8],
      precipitation_probability_max: [85, 70, 30],
      precipitation_sum: [12.42, 8.1, 0],
    },
  };

  it('correctly maps raw response to ProPOS WeatherResponseDto', () => {
    const fixedNow = 1788945000000;
    const result = mapOpenMeteoResponse(sampleRawResponse, sampleLocation, fixedNow);

    expect(result.configured).toBe(true);
    expect(result.location).toEqual(sampleLocation);
    expect(result.updatedAt).toBe(fixedNow);

    // Current weather
    expect(result.current).toBeDefined();
    expect(result.current?.temperatureC).toBe(31.4);
    expect(result.current?.apparentTemperatureC).toBe(36.2);
    expect(result.current?.humidityPercent).toBe(72);
    expect(result.current?.weatherCode).toBe(80);
    expect(result.current?.weatherLabel).toBe('Mưa rào nhẹ');
    expect(result.current?.icon).toBe('RAIN_SHOWERS');
    expect(result.current?.isDay).toBe(true);
    expect(result.current?.precipitationMm).toBe(1.3);
    expect(result.current?.windSpeedKmh).toBe(12.5);

    // Hourly
    expect(result.nextHours).toHaveLength(4);
    expect(result.nextHours?.[0]).toEqual({
      time: '2026-09-09T17:00',
      temperatureC: 31.4,
      precipitationProbabilityPercent: 75,
      weatherCode: 80,
      weatherLabel: 'Mưa rào nhẹ',
      icon: 'RAIN_SHOWERS',
    });

    // Today & Daily Forecast
    expect(result.today).toBeDefined();
    expect(result.today?.maxTemperatureC).toBe(33.5);
    expect(result.today?.minTemperatureC).toBe(25.8);
    expect(result.today?.precipitationProbabilityMaxPercent).toBe(85);
    expect(result.today?.precipitationSumMm).toBe(12.4);

    expect(result.forecast).toHaveLength(3);

    // Rain Alert derived
    expect(result.summaryAlert?.rainSoon).toBe(true);
    expect(result.summaryAlert?.rainTime).toBe('17:00');
    expect(result.summaryAlert?.rainProbabilityPercent).toBe(75);
    expect(result.summaryAlert?.message).toBe('Có khả năng mưa cao lúc 17:00');
  });

  it('detects rainSoon when probability >= 70 within next 3 hours', () => {
    const hours = [
      {
        time: '2026-09-09T15:00',
        temperatureC: 32,
        precipitationProbabilityPercent: 20,
        weatherCode: 1,
        weatherLabel: 'Ít mây',
        icon: 'PARTLY_CLOUDY_DAY' as const,
      },
      {
        time: '2026-09-09T16:00',
        temperatureC: 31,
        precipitationProbabilityPercent: 80,
        weatherCode: 80,
        weatherLabel: 'Mưa rào nhẹ',
        icon: 'RAIN_SHOWERS' as const,
      },
      {
        time: '2026-09-09T17:00',
        temperatureC: 29,
        precipitationProbabilityPercent: 60,
        weatherCode: 61,
        weatherLabel: 'Mưa nhỏ',
        icon: 'RAIN' as const,
      },
    ];

    const alert = deriveRainAlert(hours);
    expect(alert.rainSoon).toBe(true);
    expect(alert.rainTime).toBe('16:00');
    expect(alert.rainProbabilityPercent).toBe(80);
  });

  it('returns rainSoon: false when precipitation probability is below 70%', () => {
    const hours = [
      {
        time: '2026-09-09T15:00',
        temperatureC: 32,
        precipitationProbabilityPercent: 40,
        weatherCode: 1,
        weatherLabel: 'Ít mây',
        icon: 'PARTLY_CLOUDY_DAY' as const,
      },
      {
        time: '2026-09-09T16:00',
        temperatureC: 31,
        precipitationProbabilityPercent: 55,
        weatherCode: 2,
        weatherLabel: 'Mây rải rác',
        icon: 'PARTLY_CLOUDY_DAY' as const,
      },
    ];

    const alert = deriveRainAlert(hours);
    expect(alert.rainSoon).toBe(false);
    expect(alert.rainTime).toBeNull();
    expect(alert.message).toBeNull();
  });

  it('handles empty or partial raw data without crashing', () => {
    const minimalRaw: RawOpenMeteoResponse = {
      latitude: 10.82,
      longitude: 106.63,
      timezone: 'Asia/Ho_Chi_Minh',
    };

    const result = mapOpenMeteoResponse(minimalRaw, sampleLocation);
    expect(result.configured).toBe(true);
    expect(result.current).toBeUndefined();
    expect(result.nextHours).toEqual([]);
    expect(result.forecast).toEqual([]);
    expect(result.today).toBeUndefined();
    expect(result.summaryAlert).toBeNull();
  });
});
