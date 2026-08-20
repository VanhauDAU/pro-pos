import type { PricingConfigSnapshot, SpecialPriceWindow } from './types';

export class PricingConfigurationError extends Error {}

function isSelected(mask: number, weekdayIndex: number) {
  return (mask & (1 << weekdayIndex)) !== 0;
}

function activeAt(window: SpecialPriceWindow, weekday: number, minute: number) {
  if (window.startMinute === window.endMinute) {
    return isSelected(window.weekdaysMask, weekday);
  }
  if (window.startMinute < window.endMinute) {
    return (
      isSelected(window.weekdaysMask, weekday) &&
      minute >= window.startMinute &&
      minute < window.endMinute
    );
  }
  if (minute >= window.startMinute) {
    return isSelected(window.weekdaysMask, weekday);
  }
  const previousWeekday = (weekday + 6) % 7;
  return minute < window.endMinute && isSelected(window.weekdaysMask, previousWeekday);
}

export function validatePricingConfig(config: PricingConfigSnapshot): void {
  if (!Number.isInteger(config.basePriceVnd) || config.basePriceVnd <= 0) {
    throw new PricingConfigurationError('basePriceVnd must be a positive integer');
  }
  if (!Number.isInteger(config.baseDurationSeconds) || config.baseDurationSeconds <= 0) {
    throw new PricingConfigurationError('baseDurationSeconds must be a positive integer');
  }
  if (config.firstPeriod.enabled) {
    if (
      !Number.isInteger(config.firstPeriod.durationSeconds) ||
      config.firstPeriod.durationSeconds <= 0 ||
      !Number.isInteger(config.firstPeriod.priceVnd) ||
      config.firstPeriod.priceVnd <= 0
    ) {
      throw new PricingConfigurationError('Invalid first-period configuration');
    }
  }
  for (const window of config.specialWindows) {
    if (
      !Number.isInteger(window.priceVnd) ||
      window.priceVnd <= 0 ||
      !Number.isInteger(window.startMinute) ||
      window.startMinute < 0 ||
      window.startMinute > 1439 ||
      !Number.isInteger(window.endMinute) ||
      window.endMinute < 0 ||
      window.endMinute > 1439 ||
      !Number.isInteger(window.weekdaysMask) ||
      window.weekdaysMask < 1 ||
      window.weekdaysMask > 127
    ) {
      throw new PricingConfigurationError(`Invalid special window: ${window.id}`);
    }
  }

  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let minute = 0; minute < 1440; minute += 1) {
      const matches = config.specialWindows.filter((window) => activeAt(window, weekday, minute));
      if (matches.length > 1) {
        throw new PricingConfigurationError(
          `Overlapping special windows: ${matches.map((item) => item.id).join(', ')}`,
        );
      }
    }
  }
}

export { activeAt as isSpecialWindowActiveAt };
