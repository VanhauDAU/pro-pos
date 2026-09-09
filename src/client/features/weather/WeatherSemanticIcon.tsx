import React from 'react';
import type { WeatherSemanticIcon as SemanticIconType } from '@contracts/weather';
import { AnimatedWeatherIcon } from './AnimatedWeatherIcon';

export interface WeatherSemanticIconProps {
  icon?: SemanticIconType | undefined;
  size?: number | undefined;
  className?: string | undefined;
  alt?: string | undefined;
  animated?: boolean | undefined;
}

export const WeatherSemanticIcon: React.FC<WeatherSemanticIconProps> = ({
  icon = 'SUN',
  size = 20,
  className = '',
  alt,
  animated = true,
}) => {
  return (
    <AnimatedWeatherIcon
      icon={icon}
      size={size}
      className={className}
      alt={alt}
      animated={animated}
    />
  );
};
