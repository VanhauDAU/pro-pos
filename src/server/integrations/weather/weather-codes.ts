import type { WeatherSemanticIcon } from '@contracts/weather';

export interface WeatherCodeInfo {
  icon: WeatherSemanticIcon;
  label: string;
}

export function mapWmoCode(code: number, isDay = true): WeatherCodeInfo {
  switch (code) {
    case 0:
      return {
        icon: isDay ? 'SUN' : 'MOON',
        label: 'Trời quang',
      };
    case 1:
      return {
        icon: isDay ? 'PARTLY_CLOUDY_DAY' : 'PARTLY_CLOUDY_NIGHT',
        label: 'Ít mây',
      };
    case 2:
      return {
        icon: isDay ? 'PARTLY_CLOUDY_DAY' : 'PARTLY_CLOUDY_NIGHT',
        label: 'Mây rải rác',
      };
    case 3:
      return {
        icon: 'CLOUDY',
        label: 'Nhiều mây',
      };
    case 45:
      return {
        icon: 'FOG',
        label: 'Sương mù',
      };
    case 48:
      return {
        icon: 'FOG',
        label: 'Sương mù đọng băng',
      };
    case 51:
      return {
        icon: 'DRIZZLE',
        label: 'Mưa phùn nhẹ',
      };
    case 53:
      return {
        icon: 'DRIZZLE',
        label: 'Mưa phùn vừa',
      };
    case 55:
      return {
        icon: 'DRIZZLE',
        label: 'Mưa phùn dày',
      };
    case 56:
    case 57:
      return {
        icon: 'DRIZZLE',
        label: 'Mưa phùn lạnh',
      };
    case 61:
      return {
        icon: 'RAIN',
        label: 'Mưa nhỏ',
      };
    case 63:
      return {
        icon: 'RAIN',
        label: 'Mưa vừa',
      };
    case 65:
      return {
        icon: 'RAIN',
        label: 'Mưa to',
      };
    case 66:
    case 67:
      return {
        icon: 'RAIN',
        label: 'Mưa băng giá',
      };
    case 71:
      return {
        icon: 'SNOW',
        label: 'Tuyết rơi nhẹ',
      };
    case 73:
      return {
        icon: 'SNOW',
        label: 'Tuyết rơi vừa',
      };
    case 75:
      return {
        icon: 'SNOW',
        label: 'Tuyết rơi dày',
      };
    case 77:
      return {
        icon: 'SNOW',
        label: 'Hạt tuyết',
      };
    case 80:
      return {
        icon: 'RAIN_SHOWERS',
        label: 'Mưa rào nhẹ',
      };
    case 81:
      return {
        icon: 'RAIN_SHOWERS',
        label: 'Mưa rào vừa',
      };
    case 82:
      return {
        icon: 'RAIN_SHOWERS',
        label: 'Mưa rào lớn',
      };
    case 85:
    case 86:
      return {
        icon: 'SNOW',
        label: 'Mưa tuyết rào',
      };
    case 95:
      return {
        icon: 'THUNDERSTORM',
        label: 'Dông sét',
      };
    case 96:
    case 99:
      return {
        icon: 'THUNDERSTORM',
        label: 'Dông có mưa đá',
      };
    default:
      return {
        icon: isDay ? 'SUN' : 'MOON',
        label: 'Thời tiết không xác định',
      };
  }
}
