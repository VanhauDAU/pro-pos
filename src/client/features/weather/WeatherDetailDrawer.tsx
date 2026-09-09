import React from 'react';
import { Drawer, Empty, Skeleton, Tag, Typography } from 'antd';
import type { WeatherResponseDto } from '@contracts/weather';
import { WeatherSemanticIcon } from './WeatherSemanticIcon';
import './weather.css';
import {
  formatDayLabel,
  formatHour,
  formatPrecipitationMm,
  formatRainProbability,
  formatTemperature,
} from './weather-utils';

interface WeatherDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  weather?: WeatherResponseDto | null;
  loading?: boolean;
}

export const WeatherDetailDrawer: React.FC<WeatherDetailDrawerProps> = ({
  open,
  onClose,
  weather,
  loading = false,
}) => {
  const current = weather?.current;
  const location = weather?.location;
  const alert = weather?.summaryAlert;

  return (
    <Drawer
      title={
        <div className="weather-drawer-header">
          <span className="weather-drawer-header__title">Thời tiết cửa hàng</span>
          {location?.label ? (
            <span className="weather-drawer-header__location" title={location.label}>
              📍 {location.label}
            </span>
          ) : null}
        </div>
      }
      placement="right"
      width={460}
      open={open}
      onClose={onClose}
      className="weather-detail-drawer"
    >
      {loading ? (
        <Skeleton active paragraph={{ rows: 10 }} />
      ) : !weather || !weather.configured ? (
        <Empty description="Cửa hàng chưa thiết lập vị trí tọa độ để tải thời tiết." />
      ) : (
        <div className="weather-drawer-body">
          {/* ── Section 1: Current Weather Card ── */}
          <div className="weather-current-card">
            <div className="weather-current-main">
              <div className="weather-current-icon-wrap">
                <WeatherSemanticIcon icon={current?.icon} size={54} alt={current?.weatherLabel} />
              </div>
              <div className="weather-current-temp-wrap">
                <div className="weather-current-temp">
                  {formatTemperature(current?.temperatureC)}
                </div>
                <div className="weather-current-label">{current?.weatherLabel}</div>
              </div>
            </div>

            <div className="weather-current-sub">
              <span>Cảm giác như {formatTemperature(current?.apparentTemperatureC)}</span>
              {weather.today ? (
                <span>
                  Hôm nay: {formatTemperature(weather.today.minTemperatureC, '°')} /{' '}
                  {formatTemperature(weather.today.maxTemperatureC, '°')}
                </span>
              ) : null}
            </div>

            {alert?.rainSoon ? (
              <div className="weather-rain-alert-banner">
                <span className="weather-rain-alert-icon">☔</span>
                <span className="weather-rain-alert-text">
                  {alert.message} ({formatRainProbability(alert.rainProbabilityPercent)})
                </span>
              </div>
            ) : null}

            {/* Metrics grid */}
            <div className="weather-metrics-grid">
              <div className="weather-metric-item">
                <span className="weather-metric-label">Độ ẩm</span>
                <span className="weather-metric-value">{current?.humidityPercent ?? '--'}%</span>
              </div>
              <div className="weather-metric-item">
                <span className="weather-metric-label">Gió</span>
                <span className="weather-metric-value">{current?.windSpeedKmh ?? '--'} km/h</span>
              </div>
              <div className="weather-metric-item">
                <span className="weather-metric-label">Lượng mưa</span>
                <span className="weather-metric-value">
                  {formatPrecipitationMm(current?.precipitationMm)}
                </span>
              </div>
            </div>
          </div>

          {/* ── Section 2: Hourly Forecast (12h) ── */}
          {weather.nextHours && weather.nextHours.length > 0 ? (
            <div className="weather-hourly-section">
              <Typography.Title level={5} className="weather-section-title">
                Dự báo 12 giờ tới
              </Typography.Title>
              <div className="weather-hourly-scroll">
                {weather.nextHours.map((hour, idx) => {
                  const prob = hour.precipitationProbabilityPercent;
                  return (
                    <div key={idx} className="weather-hourly-card">
                      <span className="weather-hourly-time">{formatHour(hour.time)}</span>
                      <WeatherSemanticIcon icon={hour.icon} size={28} alt={hour.weatherLabel} />
                      <span className="weather-hourly-temp">
                        {formatTemperature(hour.temperatureC, '°')}
                      </span>
                      {prob > 0 ? (
                        <span className={`weather-hourly-rain ${prob >= 50 ? 'is-high' : ''}`}>
                          {prob}%
                        </span>
                      ) : (
                        <span className="weather-hourly-rain is-zero">0%</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* ── Section 3: Daily Forecast (3 days) ── */}
          {weather.forecast && weather.forecast.length > 0 ? (
            <div className="weather-daily-section">
              <Typography.Title level={5} className="weather-section-title">
                Dự báo 3 ngày tới
              </Typography.Title>
              <div className="weather-daily-list">
                {weather.forecast.map((day, idx) => (
                  <div key={idx} className="weather-daily-row">
                    <div className="weather-daily-col-day">
                      <strong>{formatDayLabel(day.date, idx)}</strong>
                      <small className="weather-daily-label">{day.weatherLabel}</small>
                    </div>

                    <div className="weather-daily-col-icon">
                      <WeatherSemanticIcon icon={day.icon} size={26} alt={day.weatherLabel} />
                    </div>

                    <div className="weather-daily-col-rain">
                      {day.precipitationProbabilityMaxPercent > 0 ? (
                        <Tag color="blue" className="weather-rain-tag">
                          ☔ {day.precipitationProbabilityMaxPercent}%
                        </Tag>
                      ) : (
                        <span className="weather-no-rain-text">Ít mưa</span>
                      )}
                    </div>

                    <div className="weather-daily-col-temp">
                      <span className="weather-temp-min">
                        {formatTemperature(day.minTemperatureC, '°')}
                      </span>
                      <span className="weather-temp-bar" />
                      <span className="weather-temp-max">
                        {formatTemperature(day.maxTemperatureC, '°')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* ── Section 4: Attribution ── */}
          <div className="weather-attribution-footer">
            <span>Nguồn dữ liệu: </span>
            <a
              href="https://open-meteo.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="weather-attribution-link"
            >
              Open-Meteo
            </a>
            <span className="weather-attribution-licence"> · CC BY 4.0</span>
          </div>
        </div>
      )}
    </Drawer>
  );
};

export default WeatherDetailDrawer;
