import { describe, expect, it } from 'vitest';
import { getAdaptiveWeatherInfo } from '@client/features/weather/weather-utils';
import type { WeatherResponseDto } from '@contracts/weather';

describe('Adaptive Weather Pill Logic', () => {
  it('returns compact temperature only on normal weather days', () => {
    const weather: WeatherResponseDto = {
      configured: true,
      current: {
        temperatureC: 26.2,
        apparentTemperatureC: 28,
        humidityPercent: 65,
        weatherCode: 1,
        weatherLabel: 'Ít mây',
        icon: 'PARTLY_CLOUDY_DAY',
        isDay: true,
        precipitationMm: 0,
        windSpeedKmh: 12,
      },
      today: {
        date: '2026-09-09',
        minTemperatureC: 23,
        maxTemperatureC: 29,
        precipitationProbabilityMaxPercent: 15,
        precipitationSumMm: 0,
        weatherCode: 1,
        weatherLabel: 'Ít mây',
        icon: 'PARTLY_CLOUDY_DAY',
      },
      nextHours: [
        {
          time: '2026-09-09T18:00',
          temperatureC: 26,
          precipitationProbabilityPercent: 10,
          weatherCode: 1,
          weatherLabel: 'Ít mây',
          icon: 'PARTLY_CLOUDY_DAY',
        },
      ],
      summaryAlert: null,
    };

    const result = getAdaptiveWeatherInfo(weather);
    expect(result.isNotable).toBe(false);
    expect(result.temperatureText).toBe('26°');
    expect(result.pillText).toBe('26°');
    expect(result.alertBadge).toBeUndefined();
  });

  it('expands pill to show rain alert when rainSoon is true', () => {
    const weather: WeatherResponseDto = {
      configured: true,
      current: {
        temperatureC: 25.9,
        apparentTemperatureC: 31.6,
        humidityPercent: 93,
        weatherCode: 3,
        weatherLabel: 'Nhiều mây',
        icon: 'CLOUDY',
        isDay: false,
        precipitationMm: 0,
        windSpeedKmh: 6.1,
      },
      summaryAlert: {
        rainSoon: true,
        rainTime: '18:00',
        rainProbabilityPercent: 100,
        message: 'Có khả năng mưa cao lúc 18:00',
      },
    };

    const result = getAdaptiveWeatherInfo(weather);
    expect(result.isNotable).toBe(true);
    expect(result.notableType).toBe('RAIN');
    expect(result.icon).toBe('RAIN');
    expect(result.temperatureText).toBe('26°');
    expect(result.alertBadge).toBe('Mưa 100%');
    expect(result.pillText).toBe('26° · Mưa 100%');
  });

  it('expands pill to show active rain when raining now', () => {
    const weather: WeatherResponseDto = {
      configured: true,
      current: {
        temperatureC: 23,
        apparentTemperatureC: 24,
        humidityPercent: 98,
        weatherCode: 63,
        weatherLabel: 'Mưa vừa',
        icon: 'RAIN',
        isDay: true,
        precipitationMm: 2.5,
        windSpeedKmh: 15,
      },
    };

    const result = getAdaptiveWeatherInfo(weather);
    expect(result.isNotable).toBe(true);
    expect(result.notableType).toBe('RAIN');
    expect(result.icon).toBe('RAIN');
    expect(result.pillText).toBe('23° · Mưa vừa');
  });

  it('expands pill to show heat alert during extreme heat', () => {
    const weather: WeatherResponseDto = {
      configured: true,
      current: {
        temperatureC: 38.2,
        apparentTemperatureC: 43.5,
        humidityPercent: 55,
        weatherCode: 0,
        weatherLabel: 'Trời quang',
        icon: 'SUN',
        isDay: true,
        precipitationMm: 0,
        windSpeedKmh: 8,
      },
    };

    const result = getAdaptiveWeatherInfo(weather);
    expect(result.isNotable).toBe(true);
    expect(result.notableType).toBe('HEAT');
    expect(result.alertBadge).toBe('Nắng nóng');
    expect(result.pillText).toBe('38° · Nắng nóng');
  });

  it('expands pill to show strong wind alert when wind speed >= 35 km/h', () => {
    const weather: WeatherResponseDto = {
      configured: true,
      current: {
        temperatureC: 25,
        apparentTemperatureC: 25,
        humidityPercent: 70,
        weatherCode: 2,
        weatherLabel: 'Mây rải rác',
        icon: 'PARTLY_CLOUDY_DAY',
        isDay: true,
        precipitationMm: 0,
        windSpeedKmh: 38,
      },
    };

    const result = getAdaptiveWeatherInfo(weather);
    expect(result.isNotable).toBe(true);
    expect(result.notableType).toBe('WIND');
    expect(result.alertBadge).toBe('Gió mạnh');
    expect(result.pillText).toBe('25° · Gió mạnh');
  });

  it('expands pill to show cold alert when temperature <= 14°C', () => {
    const weather: WeatherResponseDto = {
      configured: true,
      current: {
        temperatureC: 13,
        apparentTemperatureC: 11,
        humidityPercent: 60,
        weatherCode: 3,
        weatherLabel: 'Nhiều mây',
        icon: 'CLOUDY',
        isDay: true,
        precipitationMm: 0,
        windSpeedKmh: 14,
      },
    };

    const result = getAdaptiveWeatherInfo(weather);
    expect(result.isNotable).toBe(true);
    expect(result.notableType).toBe('COLD');
    expect(result.alertBadge).toBe('Rét đậm');
    expect(result.pillText).toBe('13° · Rét đậm');
  });
});

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnimatedWeatherIcon } from '@client/features/weather/AnimatedWeatherIcon';

describe('AnimatedWeatherIcon Component', () => {
  it('renders rain state with 3 animated raindrops and correct SVG size', () => {
    const html = renderToStaticMarkup(
      React.createElement(AnimatedWeatherIcon, { weatherType: 'rain', size: 18, animated: true }),
    );
    expect(html).toContain('width="18"');
    expect(html).toContain('height="18"');
    expect(html).toContain('weather-svg-icon--animated');
    expect(html).toContain('weather-anim-drop--1');
    expect(html).toContain('weather-anim-drop--2');
    expect(html).toContain('weather-anim-drop--3');
  });

  it('renders static mode when animated is false', () => {
    const html = renderToStaticMarkup(
      React.createElement(AnimatedWeatherIcon, { weatherType: 'rain', animated: false }),
    );
    expect(html).toContain('weather-svg-icon--static');
    expect(html).not.toContain('weather-svg-icon--animated');
  });

  it('renders sunny state with sun pulse target class', () => {
    const html = renderToStaticMarkup(
      React.createElement(AnimatedWeatherIcon, { weatherType: 'sunny' }),
    );
    expect(html).toContain('weather-anim-sun');
  });

  it('renders cloudy state with cloud drift target class', () => {
    const html = renderToStaticMarkup(
      React.createElement(AnimatedWeatherIcon, { weatherType: 'cloudy' }),
    );
    expect(html).toContain('weather-anim-cloud');
  });

  it('renders storm state with lightning target class', () => {
    const html = renderToStaticMarkup(
      React.createElement(AnimatedWeatherIcon, { weatherType: 'storm' }),
    );
    expect(html).toContain('weather-anim-lightning');
  });

  it('renders wind state with wind drift target class', () => {
    const html = renderToStaticMarkup(
      React.createElement(AnimatedWeatherIcon, { weatherType: 'wind' }),
    );
    expect(html).toContain('weather-anim-wind');
  });
});
