import React, { lazy, Suspense, useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Tooltip } from 'antd';
import { AnimatePresence, motion } from 'framer-motion';
import type { WeatherResponseDto } from '@contracts/weather';
import { apiRequest } from '@client/lib/api';
import { AnimatedWeatherIcon } from './AnimatedWeatherIcon';
import { getAdaptiveWeatherInfo } from './weather-utils';
import { usePosWeatherDisplay } from './weather-settings';
import './weather.css';

const WeatherDetailDrawer = lazy(() => import('./WeatherDetailDrawer'));

const LAST_ALERT_SIGNATURE_KEY = 'propos:pos:last_weather_alert_signature';

function getStoredAlertSignature(): string {
  try {
    return sessionStorage.getItem(LAST_ALERT_SIGNATURE_KEY) ?? '';
  } catch {
    return '';
  }
}

function setStoredAlertSignature(signature: string): void {
  try {
    sessionStorage.setItem(LAST_ALERT_SIGNATURE_KEY, signature);
  } catch {
    // Ignore storage quota or security errors
  }
}

export const WeatherChipContent: React.FC = () => {
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isAutoExpanded, setIsAutoExpanded] = useState(false);
  const [weatherEnabled] = usePosWeatherDisplay();

  // Weather is strictly restricted to Areas tab on POS.
  // Other tabs like QR Order (/pos/qr-order), More (/pos/more), reports, etc. must not show weather.
  const isAreasTab =
    location.pathname === '/pos/areas' ||
    location.pathname === '/pos' ||
    location.pathname === '/pos/';

  const shouldFetchWeather = isAreasTab && weatherEnabled;

  const { data: weather, isError } = useQuery<WeatherResponseDto>({
    queryKey: ['weather'],
    queryFn: () => apiRequest<WeatherResponseDto>('/api/v1/weather'),
    enabled: shouldFetchWeather,
    staleTime: 15 * 60 * 1000, // 15 minutes
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 1,
  });

  const adaptive =
    weather && weather.configured && weather.current ? getAdaptiveWeatherInfo(weather) : null;

  // Auto-expansion logic:
  // Only auto-expand when:
  // 1. A new notable weather alert is received for the first time.
  // 2. Weather condition changes significantly (e.g. from no alert to storm, or severity change).
  // Does NOT auto-expand on component rerender or tab switching back and forth.
  const alertSignature =
    adaptive?.isNotable && adaptive.alertBadge
      ? `${adaptive.notableType ?? 'ALERT'}:${adaptive.alertBadge}`
      : '';

  useEffect(() => {
    if (!alertSignature) {
      setStoredAlertSignature('');
      setIsAutoExpanded(false);
      return;
    }

    const lastSeen = getStoredAlertSignature();
    if (lastSeen !== alertSignature) {
      setStoredAlertSignature(alertSignature);
      setIsAutoExpanded(true);

      const timer = setTimeout(() => {
        setIsAutoExpanded(false);
      }, 4000); // Auto-expand for 4 seconds, then return to compact icon + temperature

      return () => clearTimeout(timer);
    }
  }, [alertSignature]);

  // Hide completely if:
  // - Not on the Areas tab
  // - Staff turned off weather in settings
  // - API error or no weather data configured/available (no floating placeholder created)
  if (
    !isAreasTab ||
    !weatherEnabled ||
    isError ||
    !weather ||
    !weather.configured ||
    !weather.current ||
    !adaptive
  ) {
    return null;
  }

  const modifierClass = adaptive.isNotable
    ? `pos-weather-chip--notable pos-weather-chip--${adaptive.notableType?.toLowerCase()}`
    : '';

  return (
    <>
      <Tooltip title={adaptive.fullTooltip}>
        <button
          type="button"
          className={`pos-weather-chip ${modifierClass} ${isAutoExpanded ? 'pos-weather-chip--expanded' : ''}`}
          onClick={() => setDrawerOpen(true)}
          aria-label={adaptive.fullTooltip}
        >
          <AnimatedWeatherIcon weatherType={adaptive.icon} size={15} />
          <span className="pos-weather-chip__temp">{adaptive.temperatureText}</span>

          <AnimatePresence>
            {isAutoExpanded && adaptive.alertBadge ? (
              <motion.span
                key="alert"
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.35, ease: 'easeInOut' }}
                className="pos-weather-chip__expand-alert"
              >
                <span className="pos-weather-chip__separator">·</span>
                <span className="pos-weather-chip__alert-text">{adaptive.alertBadge}</span>
              </motion.span>
            ) : null}
          </AnimatePresence>
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
