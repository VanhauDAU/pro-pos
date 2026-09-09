import type {
  WeatherAlertDto,
  WeatherCurrentDto,
  WeatherDailyDto,
  WeatherHourlyDto,
  WeatherLocationDto,
  WeatherResponseDto,
} from '@contracts/weather';
import type { RawOpenMeteoResponse } from './open-meteo-client';
import { mapWmoCode } from './weather-codes';

export function deriveRainAlert(hours: WeatherHourlyDto[]): WeatherAlertDto {
  const next3Hours = hours.slice(0, 3);
  const highRainHour = next3Hours.find((h) => h.precipitationProbabilityPercent >= 70);

  if (!highRainHour) {
    return {
      rainSoon: false,
      rainTime: null,
      rainProbabilityPercent: null,
      message: null,
    };
  }

  const highestHour = next3Hours.reduce((max, cur) =>
    cur.precipitationProbabilityPercent > max.precipitationProbabilityPercent ? cur : max,
  );

  const formattedTime = highestHour.time.includes('T')
    ? (highestHour.time.split('T')[1]?.slice(0, 5) ?? highestHour.time)
    : highestHour.time.slice(0, 5);

  return {
    rainSoon: true,
    rainTime: formattedTime,
    rainProbabilityPercent: highestHour.precipitationProbabilityPercent,
    message: `Có khả năng mưa cao lúc ${formattedTime}`,
  };
}

export function mapOpenMeteoResponse(
  raw: RawOpenMeteoResponse,
  storeLocation: WeatherLocationDto,
  now = Date.now(),
): WeatherResponseDto {
  const currentRaw = raw.current;
  const isDay = currentRaw ? currentRaw.is_day !== 0 : true;

  let current: WeatherCurrentDto | undefined;
  if (currentRaw) {
    const codeInfo = mapWmoCode(currentRaw.weather_code, isDay);
    current = {
      temperatureC: Math.round(currentRaw.temperature_2m * 10) / 10,
      apparentTemperatureC: Math.round(currentRaw.apparent_temperature * 10) / 10,
      humidityPercent: Math.round(currentRaw.relative_humidity_2m),
      weatherCode: currentRaw.weather_code,
      weatherLabel: codeInfo.label,
      icon: codeInfo.icon,
      isDay,
      precipitationMm: Math.round((currentRaw.precipitation ?? 0) * 10) / 10,
      windSpeedKmh: Math.round((currentRaw.wind_speed_10m ?? 0) * 10) / 10,
    };
  }

  const nextHours: WeatherHourlyDto[] = [];
  if (raw.hourly?.time && Array.isArray(raw.hourly.time)) {
    const length = Math.min(raw.hourly.time.length, 12);
    for (let i = 0; i < length; i++) {
      const timeVal = raw.hourly.time[i] ?? '';
      const code = raw.hourly.weather_code?.[i] ?? 0;
      const codeInfo = mapWmoCode(code, true);
      nextHours.push({
        time: timeVal,
        temperatureC: Math.round((raw.hourly.temperature_2m?.[i] ?? 0) * 10) / 10,
        precipitationProbabilityPercent: Math.round(raw.hourly.precipitation_probability?.[i] ?? 0),
        weatherCode: code,
        weatherLabel: codeInfo.label,
        icon: codeInfo.icon,
      });
    }
  }

  const forecast: WeatherDailyDto[] = [];
  if (raw.daily?.time && Array.isArray(raw.daily.time)) {
    const length = Math.min(raw.daily.time.length, 3);
    for (let i = 0; i < length; i++) {
      const dateVal = raw.daily.time[i] ?? '';
      const code = raw.daily.weather_code?.[i] ?? 0;
      const codeInfo = mapWmoCode(code, true);
      forecast.push({
        date: dateVal,
        minTemperatureC: Math.round((raw.daily.temperature_2m_min?.[i] ?? 0) * 10) / 10,
        maxTemperatureC: Math.round((raw.daily.temperature_2m_max?.[i] ?? 0) * 10) / 10,
        precipitationProbabilityMaxPercent: Math.round(
          raw.daily.precipitation_probability_max?.[i] ?? 0,
        ),
        precipitationSumMm: Math.round((raw.daily.precipitation_sum?.[i] ?? 0) * 10) / 10,
        weatherCode: code,
        weatherLabel: codeInfo.label,
        icon: codeInfo.icon,
      });
    }
  }

  const today = forecast[0] ?? undefined;
  const summaryAlert = nextHours.length > 0 ? deriveRainAlert(nextHours) : null;

  return {
    configured: true,
    location: storeLocation,
    current,
    nextHours,
    today,
    forecast,
    summaryAlert,
    updatedAt: now,
  };
}
