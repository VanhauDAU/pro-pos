export type WeatherSemanticIcon =
  | 'SUN'
  | 'MOON'
  | 'PARTLY_CLOUDY_DAY'
  | 'PARTLY_CLOUDY_NIGHT'
  | 'CLOUDY'
  | 'FOG'
  | 'DRIZZLE'
  | 'RAIN'
  | 'RAIN_SHOWERS'
  | 'THUNDERSTORM'
  | 'SNOW';

export interface WeatherLocationDto {
  latitude: number;
  longitude: number;
  label?: string | null | undefined;
}

export interface WeatherCurrentDto {
  temperatureC: number;
  apparentTemperatureC: number;
  humidityPercent: number;
  weatherCode: number;
  weatherLabel: string;
  icon: WeatherSemanticIcon;
  isDay: boolean;
  precipitationMm: number;
  windSpeedKmh: number;
}

export interface WeatherHourlyDto {
  time: string;
  temperatureC: number;
  precipitationProbabilityPercent: number;
  weatherCode: number;
  weatherLabel: string;
  icon: WeatherSemanticIcon;
}

export interface WeatherDailyDto {
  date: string;
  minTemperatureC: number;
  maxTemperatureC: number;
  precipitationProbabilityMaxPercent: number;
  precipitationSumMm: number;
  weatherCode: number;
  weatherLabel: string;
  icon: WeatherSemanticIcon;
}

export interface WeatherAlertDto {
  rainSoon: boolean;
  rainTime?: string | null | undefined;
  rainProbabilityPercent?: number | null | undefined;
  message?: string | null | undefined;
}

export interface WeatherResponseDto {
  configured: boolean;
  location?: WeatherLocationDto | undefined;
  current?: WeatherCurrentDto | undefined;
  nextHours?: WeatherHourlyDto[] | undefined;
  today?: WeatherDailyDto | undefined;
  forecast?: WeatherDailyDto[] | undefined;
  summaryAlert?: WeatherAlertDto | null | undefined;
  updatedAt?: number | undefined;
  isStale?: boolean | undefined;
}
