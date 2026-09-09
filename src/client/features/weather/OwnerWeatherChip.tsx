import React, { lazy, Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Tooltip } from 'antd';
import { EnvironmentOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router';
import type { WeatherResponseDto } from '@contracts/weather';
import { apiRequest } from '@client/lib/api';
import { AnimatedWeatherIcon } from './AnimatedWeatherIcon';
import { getAdaptiveWeatherInfo } from './weather-utils';
import './weather.css';

const WeatherDetailDrawer = lazy(() => import('./WeatherDetailDrawer'));

export const OwnerWeatherChip: React.FC = () => {
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
    return null;
  }

  if (isError) {
    return (
      <Tooltip title="Tạm thời chưa tải được thời tiết. Bấm để thử lại.">
        <Button
          size="small"
          type="text"
          icon={<ReloadOutlined spin={isFetching} style={{ color: '#94a3b8' }} />}
          onClick={() => void refetch()}
          aria-label="Thử tải lại thời tiết"
        />
      </Tooltip>
    );
  }

  // If location not configured
  if (!weather || !weather.configured) {
    return (
      <Tooltip title="Chưa ghim vị trí cửa hàng. Bấm để chọn vị trí trên bản đồ và xem thời tiết.">
        <Button
          size="small"
          type="dashed"
          icon={<EnvironmentOutlined style={{ color: '#0975F7' }} />}
          onClick={() => navigate('/owner/qr-order/settings')}
          className="owner-header-weather-btn--unconfigured"
        >
          <span className="owner-header-weather-btn__text">Vị trí quán</span>
        </Button>
      </Tooltip>
    );
  }

  const current = weather.current;
  if (!current) {
    return null;
  }

  const adaptive = getAdaptiveWeatherInfo(weather);
  const modifierClass = adaptive.isNotable
    ? `owner-header-weather-chip--notable owner-header-weather-chip--${adaptive.notableType?.toLowerCase()}`
    : '';

  return (
    <>
      <Tooltip title={adaptive.fullTooltip}>
        <button
          type="button"
          className={`owner-header-weather-chip ${modifierClass}`}
          onClick={() => setDrawerOpen(true)}
          aria-label={adaptive.fullTooltip}
        >
          <AnimatedWeatherIcon weatherType={adaptive.icon} size={16} />
          <span className="owner-header-weather-chip__text">{adaptive.pillText}</span>
        </button>
      </Tooltip>

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
