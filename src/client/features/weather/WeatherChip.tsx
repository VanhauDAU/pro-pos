import React, { lazy, Suspense } from 'react';

const WeatherChipContent = lazy(async () => {
  const module = await import('./WeatherChipContent');
  return { default: module.WeatherChipContent };
});

export const WeatherChip: React.FC = () => (
  <Suspense fallback={null}>
    <WeatherChipContent />
  </Suspense>
);
