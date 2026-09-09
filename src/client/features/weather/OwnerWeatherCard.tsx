import React, { lazy, Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Skeleton, Tooltip } from 'antd';
import {
  CloudOutlined,
  EnvironmentOutlined,
  ReloadOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router';
import type { WeatherResponseDto } from '@contracts/weather';
import { apiRequest } from '@client/lib/api';
import { WeatherSemanticIcon } from './WeatherSemanticIcon';
import { formatRainProbability, formatTemperature } from './weather-utils';
import './weather.css';

const WeatherDetailDrawer = lazy(() => import('./WeatherDetailDrawer'));

export const OwnerWeatherCard: React.FC = () => {
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const {
    data: weather,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery<WeatherResponseDto>({
    queryKey: ['weather'],
    queryFn: () => apiRequest<WeatherResponseDto>('/api/v1/weather'),
    staleTime: (query) => (query.state.data?.configured ? 15 * 60 * 1000 : 0),
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
    retry: 1,
  });

  if (isLoading) {
    return (
      <Card className="owner-weather-card owner-weather-card--loading">
        <Skeleton active paragraph={{ rows: 2 }} />
      </Card>
    );
  }

  // If request failed
  if (isError) {
    return (
      <Card className="owner-weather-card owner-weather-card--error">
        <div className="owner-weather-unconfigured__content">
          <div className="owner-weather-unconfigured__icon" style={{ color: '#faad14' }}>
            <CloudOutlined />
          </div>
          <div className="owner-weather-unconfigured__text">
            <strong>Tạm thời chưa tải được thời tiết</strong>
            <span>Dịch vụ thời tiết tạm thời không phản hồi. Vui lòng kiểm tra lại.</span>
          </div>
          <Tooltip title="Thử lại">
            <Button
              size="small"
              icon={<ReloadOutlined spin={isFetching} />}
              onClick={() => void refetch()}
            >
              Thử lại
            </Button>
          </Tooltip>
        </div>
      </Card>
    );
  }

  // If not configured
  if (!weather || !weather.configured) {
    return (
      <Card className="owner-weather-card owner-weather-card--unconfigured">
        <div className="owner-weather-unconfigured__content">
          <div className="owner-weather-unconfigured__icon">
            <EnvironmentOutlined />
          </div>
          <div className="owner-weather-unconfigured__text">
            <strong>Chưa thiết lập vị trí cửa hàng</strong>
            <span>Cần chọn vị trí trên bản đồ để cập nhật thời tiết và dự báo mưa.</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Tooltip title="Kiểm tra lại">
              <Button
                size="small"
                icon={<ReloadOutlined spin={isFetching} />}
                onClick={() => void refetch()}
              />
            </Tooltip>
            <Button
              type="primary"
              size="small"
              onClick={() => navigate('/owner/qr-order/settings')}
              className="owner-weather-unconfigured__cta"
            >
              Cấu hình vị trí
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  const current = weather.current;
  const alert = weather.summaryAlert;
  const today = weather.today;

  return (
    <>
      <Card className="owner-weather-card" onClick={() => setDrawerOpen(true)} hoverable>
        <div className="owner-weather-card__head">
          <span className="owner-weather-card__title">Thời tiết cửa hàng</span>
          <span className="owner-weather-card__more">
            Chi tiết <RightOutlined style={{ fontSize: 10 }} />
          </span>
        </div>

        <div className="owner-weather-card__body">
          <div className="owner-weather-card__main">
            <WeatherSemanticIcon icon={current?.icon} size={36} alt={current?.weatherLabel} />
            <div className="owner-weather-card__temp-group">
              <span className="owner-weather-card__temp">
                {formatTemperature(current?.temperatureC)}
              </span>
              <span className="owner-weather-card__apparent">
                Cảm giác {formatTemperature(current?.apparentTemperatureC)}
              </span>
            </div>
          </div>

          <div className="owner-weather-card__details">
            <div className="owner-weather-card__metric">
              <span>Độ ẩm {current?.humidityPercent ?? '--'}%</span>
              {alert?.rainSoon ? (
                <span className="owner-weather-card__alert-rain">
                  ☔ Mưa {formatRainProbability(alert.rainProbabilityPercent)} lúc {alert.rainTime}
                </span>
              ) : (
                <span>
                  Khả năng mưa{' '}
                  {formatRainProbability(
                    today?.precipitationProbabilityMaxPercent ??
                      weather.nextHours?.[0]?.precipitationProbabilityPercent ??
                      0,
                  )}
                </span>
              )}
            </div>

            {today ? (
              <div className="owner-weather-card__today">
                Hôm nay: {formatTemperature(today.minTemperatureC, '°')} /{' '}
                {formatTemperature(today.maxTemperatureC, '°')}
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      {drawerOpen && (
        <Suspense fallback={null}>
          <WeatherDetailDrawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            weather={weather}
          />
        </Suspense>
      )}
    </>
  );
};
