export function formatTemperature(temp?: number | null, unit = '°C'): string {
  if (temp === undefined || temp === null || Number.isNaN(temp)) return '--';
  const rounded = Math.round(temp);
  return `${rounded}${unit}`;
}

export function formatRainProbability(prob?: number | null): string {
  if (prob === undefined || prob === null || Number.isNaN(prob)) return '0%';
  return `${Math.round(prob)}%`;
}

export function formatPrecipitationMm(mm?: number | null): string {
  if (mm === undefined || mm === null || Number.isNaN(mm)) return '0 mm';
  return `${Math.round(mm * 10) / 10} mm`;
}

export function formatHour(timeStr?: string | null): string {
  if (!timeStr) return '--:--';
  if (timeStr.includes('T')) {
    return timeStr.split('T')[1]?.slice(0, 5) ?? timeStr.slice(0, 5);
  }
  return timeStr.slice(0, 5);
}

export function formatDayLabel(dateStr?: string | null, index = 0): string {
  if (!dateStr) return '';
  if (index === 0) return 'Hôm nay';
  if (index === 1) return 'Ngày mai';

  try {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return dateStr;
    const dayOfWeek = date.getDay();
    const days = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
    return `${days[dayOfWeek]}, ${date.getDate()}/${date.getMonth() + 1}`;
  } catch {
    return dateStr;
  }
}

import type { WeatherResponseDto, WeatherSemanticIcon } from '@contracts/weather';

export interface AdaptiveWeatherInfo {
  isNotable: boolean;
  notableType?: 'RAIN' | 'HEAT' | 'WIND' | 'COLD' | undefined;
  icon: WeatherSemanticIcon;
  temperatureText: string;
  pillText: string;
  alertBadge?: string | undefined;
  fullTooltip: string;
}

export function getAdaptiveWeatherInfo(weather: WeatherResponseDto): AdaptiveWeatherInfo {
  const current = weather.current;
  if (!current) {
    return {
      isNotable: false,
      icon: 'SUN',
      temperatureText: '--',
      pillText: '--',
      fullTooltip: 'Không có dữ liệu thời tiết',
    };
  }

  const tempText = formatTemperature(current.temperatureC, '°');
  const alert = weather.summaryAlert;
  const todayRainProb =
    weather.today?.precipitationProbabilityMaxPercent ??
    weather.nextHours?.[0]?.precipitationProbabilityPercent ??
    0;

  // 1. Rain / Storm conditions (rainSoon, active rain, or high rain probability >= 70%)
  if (alert?.rainSoon) {
    const rainBadge = `Mưa ${formatRainProbability(alert.rainProbabilityPercent)}`;
    return {
      isNotable: true,
      notableType: 'RAIN',
      icon: 'RAIN',
      temperatureText: tempText,
      pillText: `${tempText} · ${rainBadge}`,
      alertBadge: rainBadge,
      fullTooltip: `${current.weatherLabel} (${current.temperatureC}°C). ${alert.message}. Bấm để xem dự báo.`,
    };
  }

  if (current.precipitationMm > 0 || (current.weatherCode >= 51 && current.weatherCode <= 99)) {
    let rainBadge = 'Đang mưa';
    let rainIcon: WeatherSemanticIcon = 'RAIN';
    if (current.weatherCode >= 95) {
      rainBadge = 'Dông sét';
      rainIcon = 'THUNDERSTORM';
    } else if (current.weatherCode >= 65 || current.precipitationMm >= 3) {
      rainBadge = 'Mưa to';
    } else if (current.weatherCode >= 61) {
      rainBadge = 'Mưa vừa';
    }

    return {
      isNotable: true,
      notableType: 'RAIN',
      icon: rainIcon,
      temperatureText: tempText,
      pillText: `${tempText} · ${rainBadge}`,
      alertBadge: rainBadge,
      fullTooltip: `${current.weatherLabel} (${current.temperatureC}°C). Bấm để xem dự báo.`,
    };
  }

  if (todayRainProb >= 70) {
    const rainBadge = `Mưa ${formatRainProbability(todayRainProb)}`;
    return {
      isNotable: true,
      notableType: 'RAIN',
      icon: 'RAIN',
      temperatureText: tempText,
      pillText: `${tempText} · ${rainBadge}`,
      alertBadge: rainBadge,
      fullTooltip: `${current.weatherLabel} (${current.temperatureC}°C). Khả năng mưa cao ${todayRainProb}%. Bấm để xem dự báo.`,
    };
  }

  // 2. Extreme heat (>= 37°C or apparent >= 40°C)
  if (
    current.temperatureC >= 37 ||
    (current.apparentTemperatureC !== undefined && current.apparentTemperatureC >= 40)
  ) {
    const heatBadge = current.temperatureC >= 39 ? 'Nắng gắt' : 'Nắng nóng';
    return {
      isNotable: true,
      notableType: 'HEAT',
      icon: 'SUN',
      temperatureText: tempText,
      pillText: `${tempText} · ${heatBadge}`,
      alertBadge: heatBadge,
      fullTooltip: `${current.weatherLabel} (${current.temperatureC}°C, cảm giác ${formatTemperature(current.apparentTemperatureC)}). Nắng nóng gay gắt. Bấm để xem dự báo.`,
    };
  }

  // 3. Strong winds (>= 35 km/h)
  if (current.windSpeedKmh >= 35) {
    const windBadge = 'Gió mạnh';
    return {
      isNotable: true,
      notableType: 'WIND',
      icon: 'FOG',
      temperatureText: tempText,
      pillText: `${tempText} · ${windBadge}`,
      alertBadge: windBadge,
      fullTooltip: `${current.weatherLabel} (${current.temperatureC}°C). Gió mạnh ${Math.round(current.windSpeedKmh)} km/h. Bấm để xem dự báo.`,
    };
  }

  // 4. Cold snap (<= 14°C)
  if (current.temperatureC <= 14) {
    const coldBadge = 'Rét đậm';
    return {
      isNotable: true,
      notableType: 'COLD',
      icon: current.icon,
      temperatureText: tempText,
      pillText: `${tempText} · ${coldBadge}`,
      alertBadge: coldBadge,
      fullTooltip: `${current.weatherLabel} (${current.temperatureC}°C). Trời rét đậm. Bấm để xem dự báo.`,
    };
  }

  // Normal day: Keep it ultra-compact!
  return {
    isNotable: false,
    icon: current.icon,
    temperatureText: tempText,
    pillText: tempText,
    fullTooltip: `${current.weatherLabel} (${current.temperatureC}°C). Bấm để xem chi tiết dự báo.`,
  };
}
