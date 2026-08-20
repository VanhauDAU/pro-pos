import type { TimeCalculationMode } from '@contracts/domain';

export interface SpecialPriceWindow {
  id: string;
  name: string;
  priceVnd: number;
  startMinute: number;
  endMinute: number;
  /** Monday is bit 0, Sunday is bit 6. */
  weekdaysMask: number;
}

export interface PricingConfigSnapshot {
  version: number;
  timezone: string;
  basePriceVnd: number;
  baseDurationSeconds: number;
  calculationMode: TimeCalculationMode;
  roundingUnitVnd: 0 | 100 | 500 | 1000 | 5000;
  firstPeriod:
    | { enabled: false }
    | {
        enabled: true;
        durationSeconds: number;
        priceVnd: number;
      };
  specialWindows: SpecialPriceWindow[];
}

export interface PauseInterval {
  pausedAtMs: number;
  resumedAtMs: number;
}

export interface PricingSegment {
  type: 'FIRST_PERIOD' | 'SPECIAL' | 'BASE';
  windowId?: string;
  name: string;
  startedAtMs: number;
  endedAtMs: number;
  elapsedSeconds: number;
  priceVnd: number;
  durationSeconds: number;
  amountBeforeRoundingVnd: number;
}

export interface PricingResult {
  elapsedSeconds: number;
  amountBeforeRoundingVnd: number;
  amountAfterRoundingVnd: number;
  segments: PricingSegment[];
}
