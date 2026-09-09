import React from 'react';
import type { WeatherSemanticIcon as SemanticIconType } from '@contracts/weather';
import './weather.css';

export type WeatherIconType =
  SemanticIconType | 'rain' | 'sunny' | 'cloudy' | 'storm' | 'wind' | 'snow' | 'drizzle' | 'fog';

export interface AnimatedWeatherIconProps {
  weatherType?: WeatherIconType | undefined;
  icon?: WeatherIconType | undefined;
  size?: number | undefined;
  animated?: boolean | undefined;
  className?: string | undefined;
  alt?: string | undefined;
}

function normalizeWeatherType(input?: WeatherIconType): SemanticIconType {
  if (!input) return 'SUN';
  const upper = input.toUpperCase();
  if (upper === 'RAIN' || upper === 'RAINY') return 'RAIN';
  if (upper === 'SUNNY' || upper === 'CLEAR' || upper === 'SUN') return 'SUN';
  if (upper === 'CLOUDY' || upper === 'CLOUD') return 'CLOUDY';
  if (upper === 'STORM' || upper === 'THUNDERSTORM') return 'THUNDERSTORM';
  if (upper === 'WIND' || upper === 'FOG') return 'FOG';
  if (upper === 'SNOW') return 'SNOW';
  if (upper === 'DRIZZLE') return 'DRIZZLE';
  if (upper === 'RAIN_SHOWERS') return 'RAIN_SHOWERS';
  if (upper === 'PARTLY_CLOUDY_DAY') return 'PARTLY_CLOUDY_DAY';
  if (upper === 'PARTLY_CLOUDY_NIGHT') return 'PARTLY_CLOUDY_NIGHT';
  if (upper === 'MOON') return 'MOON';
  return 'SUN';
}

export const AnimatedWeatherIcon: React.FC<AnimatedWeatherIconProps> = ({
  weatherType,
  icon,
  size = 20,
  animated = true,
  className = '',
  alt,
}) => {
  const resolvedType = normalizeWeatherType(weatherType ?? icon);

  const iconProps = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    className:
      `weather-svg-icon ${animated ? 'weather-svg-icon--animated' : 'weather-svg-icon--static'} ${className}`.trim(),
    'aria-hidden': alt ? undefined : true,
    'aria-label': alt,
    role: alt ? 'img' : undefined,
  };

  switch (resolvedType) {
    case 'SUN':
      return (
        <svg {...iconProps}>
          <g className="weather-anim-sun">
            <circle cx="12" cy="12" r="5" fill="#f59e0b" />
            <path
              d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41m14.14-14.14l-1.41 1.41"
              stroke="#f59e0b"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </g>
        </svg>
      );

    case 'MOON':
      return (
        <svg {...iconProps}>
          <path
            d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"
            fill="#3b82f6"
            stroke="#2563eb"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="weather-anim-moon"
          />
        </svg>
      );

    case 'PARTLY_CLOUDY_DAY':
      return (
        <svg {...iconProps}>
          <circle cx="10" cy="9" r="4" fill="#f59e0b" className="weather-anim-sun" />
          <path
            d="M19 18a4 4 0 00-3.8-5.3 5 5 0 00-8.9 1.8A4 4 0 007 22h12a4 4 0 000-8"
            fill="#94a3b8"
            stroke="#64748b"
            strokeWidth="1.5"
            strokeLinejoin="round"
            transform="scale(0.8) translate(3, 4)"
            className="weather-anim-cloud"
          />
        </svg>
      );

    case 'PARTLY_CLOUDY_NIGHT':
      return (
        <svg {...iconProps}>
          <path
            d="M15 4a5 5 0 00-4 7.5A6 6 0 005 17h14a5 5 0 00-4-13z"
            fill="#64748b"
            stroke="#475569"
            strokeWidth="1.5"
            strokeLinejoin="round"
            className="weather-anim-cloud"
          />
          <circle cx="16" cy="6" r="3" fill="#60a5fa" className="weather-anim-moon" />
        </svg>
      );

    case 'CLOUDY':
      return (
        <svg {...iconProps}>
          <g className="weather-anim-cloud">
            <path
              d="M17.5 19H6.5A4.5 4.5 0 016 10a6 6 0 0111.5-1.5A4.5 4.5 0 0117.5 19z"
              fill="#94a3b8"
              stroke="#64748b"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </g>
        </svg>
      );

    case 'FOG':
      return (
        <svg {...iconProps}>
          <g className="weather-anim-wind">
            <path
              d="M4 8h16M3 12h18M5 16h14M7 20h10"
              stroke="#94a3b8"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </g>
        </svg>
      );

    case 'DRIZZLE':
      return (
        <svg {...iconProps}>
          <path
            d="M17 13.5h-10a4 4 0 01-.5-7.9A5 5 0 0116 8 3.5 3.5 0 0117 13.5z"
            fill="#94a3b8"
            stroke="#64748b"
            strokeWidth="1.2"
          />
          <g className="weather-anim-raindrops">
            <g className="weather-anim-drop weather-anim-drop--1">
              <line
                x1="8"
                y1="15"
                x2="7.5"
                y2="17.5"
                stroke="#38bdf8"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </g>
            <g className="weather-anim-drop weather-anim-drop--2">
              <line
                x1="12"
                y1="15"
                x2="11.5"
                y2="17.5"
                stroke="#38bdf8"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </g>
            <g className="weather-anim-drop weather-anim-drop--3">
              <line
                x1="16"
                y1="15"
                x2="15.5"
                y2="17.5"
                stroke="#38bdf8"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </g>
          </g>
        </svg>
      );

    case 'RAIN':
    case 'RAIN_SHOWERS':
      return (
        <svg {...iconProps}>
          {/* Cloud body (steady, serene) */}
          <path
            d="M17 12h-10a4 4 0 01-.5-7.9A5 5 0 0116 6.5 3.5 3.5 0 0117 12z"
            fill="#94a3b8"
            stroke="#64748b"
            strokeWidth="1.2"
          />
          {/* 3 gentle raindrops translating down 3-5px and fading */}
          <g className="weather-anim-raindrops">
            <g className="weather-anim-drop weather-anim-drop--1">
              <line
                x1="8.5"
                y1="14.5"
                x2="7.5"
                y2="17.5"
                stroke="#0284c7"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </g>
            <g className="weather-anim-drop weather-anim-drop--2">
              <line
                x1="12"
                y1="14.5"
                x2="11"
                y2="17.5"
                stroke="#0284c7"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </g>
            <g className="weather-anim-drop weather-anim-drop--3">
              <line
                x1="15.5"
                y1="14.5"
                x2="14.5"
                y2="17.5"
                stroke="#0284c7"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </g>
          </g>
        </svg>
      );

    case 'THUNDERSTORM':
      return (
        <svg {...iconProps}>
          <path
            d="M17 12h-10a4 4 0 01-.5-7.9A5 5 0 0116 6.5 3.5 3.5 0 0117 12z"
            fill="#475569"
            stroke="#334155"
            strokeWidth="1.2"
          />
          <path
            d="M13 13l-3 4h3l-1 5 4-5h-3l1-4z"
            fill="#f59e0b"
            stroke="#d97706"
            strokeWidth="1"
            strokeLinejoin="round"
            className="weather-anim-lightning"
          />
        </svg>
      );

    case 'SNOW':
      return (
        <svg {...iconProps}>
          <path
            d="M17 14h-10a4 4 0 01-.5-7.9A5 5 0 0116 8.5 3.5 3.5 0 0117 14z"
            fill="#cbd5e1"
            stroke="#94a3b8"
            strokeWidth="1.2"
          />
          <g className="weather-anim-snow">
            <circle
              cx="8"
              cy="17.5"
              r="1"
              fill="#38bdf8"
              className="weather-anim-drop weather-anim-drop--1"
            />
            <circle
              cx="12"
              cy="18.5"
              r="1"
              fill="#38bdf8"
              className="weather-anim-drop weather-anim-drop--2"
            />
            <circle
              cx="16"
              cy="17.5"
              r="1"
              fill="#38bdf8"
              className="weather-anim-drop weather-anim-drop--3"
            />
          </g>
        </svg>
      );

    default:
      return (
        <svg {...iconProps}>
          <circle cx="12" cy="12" r="5" fill="#f59e0b" />
        </svg>
      );
  }
};
