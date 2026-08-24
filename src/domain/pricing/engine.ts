import { isSpecialWindowActiveAt, validatePricingConfig } from './validation';
import type { PauseInterval, PricingConfigSnapshot, PricingResult, PricingSegment } from './types';

interface Fraction {
  numerator: bigint;
  denominator: bigint;
}

interface DraftSegment extends Omit<PricingSegment, 'amountBeforeRoundingVnd'> {
  amount: Fraction;
}

const weekdayMap: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

function gcd(a: bigint, b: bigint): bigint {
  let left = a < 0n ? -a : a;
  let right = b < 0n ? -b : b;
  while (right !== 0n) {
    const next = left % right;
    left = right;
    right = next;
  }
  return left;
}

function addFraction(left: Fraction, right: Fraction): Fraction {
  const divisor = gcd(left.denominator, right.denominator);
  const denominator = (left.denominator / divisor) * right.denominator;
  return {
    numerator:
      left.numerator * (right.denominator / divisor) +
      right.numerator * (left.denominator / divisor),
    denominator,
  };
}

function roundHalfUp(value: Fraction): number {
  const rounded = (value.numerator * 2n + value.denominator) / (value.denominator * 2n);
  return Number(rounded);
}

function roundMoney(value: number, unit: number): number {
  if (unit === 0) return value;
  return Math.floor((value + unit / 2) / unit) * unit;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string) {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function localTime(timestampMs: number, timezone: string) {
  const parts = getFormatter(timezone).formatToParts(new Date(timestampMs));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekday = weekdayMap[values.weekday ?? ''];
  if (weekday === undefined) throw new Error('Unable to resolve local weekday');
  return {
    weekday,
    minute: Number(values.hour) * 60 + Number(values.minute),
    second: Number(values.second),
  };
}

function subtractPauses(startedAtMs: number, endedAtMs: number, pauses: PauseInterval[]) {
  const normalized = pauses
    .map((pause) => ({
      start: Math.max(startedAtMs, pause.pausedAtMs),
      end: Math.min(endedAtMs, pause.resumedAtMs),
    }))
    .filter((pause) => pause.end > pause.start);
  // oxlint-disable-next-line unicorn/no-array-sort -- normalized is a fresh array owned here.
  normalized.sort((left, right) => left.start - right.start);

  const merged: Array<{ start: number; end: number }> = [];
  for (const pause of normalized) {
    const last = merged.at(-1);
    if (last && pause.start <= last.end) {
      last.end = Math.max(last.end, pause.end);
    } else {
      merged.push({ ...pause });
    }
  }

  const intervals: Array<{ start: number; end: number }> = [];
  let cursor = startedAtMs;
  for (const pause of merged) {
    if (pause.start > cursor) intervals.push({ start: cursor, end: pause.start });
    cursor = Math.max(cursor, pause.end);
  }
  if (cursor < endedAtMs) intervals.push({ start: cursor, end: endedAtMs });
  return intervals;
}

function segmentAmount(
  elapsedSeconds: number,
  priceVnd: number,
  durationSeconds: number,
  mode: PricingConfigSnapshot['calculationMode'],
): Fraction {
  if (mode === 'TIME_BLOCK') {
    const blocks = Math.ceil(elapsedSeconds / durationSeconds);
    return { numerator: BigInt(blocks * priceVnd), denominator: 1n };
  }
  return {
    numerator: BigInt(priceVnd) * BigInt(elapsedSeconds),
    denominator: BigInt(durationSeconds),
  };
}

function mergeSegments(segments: DraftSegment[], mode: PricingConfigSnapshot['calculationMode']) {
  const merged: DraftSegment[] = [];
  for (const segment of segments) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.type === segment.type &&
      previous.windowId === segment.windowId &&
      previous.priceVnd === segment.priceVnd &&
      previous.durationSeconds === segment.durationSeconds &&
      (previous.endedAtMs === segment.startedAtMs || mode === 'TIME_BLOCK')
    ) {
      previous.endedAtMs = segment.endedAtMs;
      previous.elapsedSeconds += segment.elapsedSeconds;
      previous.amount = segmentAmount(
        previous.elapsedSeconds,
        previous.priceVnd,
        previous.durationSeconds,
        mode,
      );
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}

export function calculateTimePrice(input: {
  startedAtMs: number;
  endedAtMs: number;
  pauses?: PauseInterval[];
  config: PricingConfigSnapshot;
}): PricingResult {
  validatePricingConfig(input.config);
  if (input.endedAtMs <= input.startedAtMs) {
    return {
      elapsedSeconds: 0,
      amountBeforeRoundingVnd: 0,
      amountAfterRoundingVnd: 0,
      segments: [],
    };
  }

  const activeIntervals = subtractPauses(input.startedAtMs, input.endedAtMs, input.pauses ?? []);
  let firstRemaining = input.config.firstPeriod.enabled
    ? input.config.firstPeriod.durationSeconds
    : 0;
  const drafts: DraftSegment[] = [];

  for (const interval of activeIntervals) {
    let cursor = interval.start;
    while (cursor < interval.end) {
      const remainingSeconds = Math.floor((interval.end - cursor) / 1000);
      if (remainingSeconds <= 0) break;

      if (firstRemaining > 0 && input.config.firstPeriod.enabled) {
        const elapsedSeconds = Math.min(firstRemaining, remainingSeconds);
        const endedAtMs = cursor + elapsedSeconds * 1000;
        drafts.push({
          type: 'FIRST_PERIOD',
          name: 'Giờ đầu tiên',
          startedAtMs: cursor,
          endedAtMs,
          elapsedSeconds,
          priceVnd: input.config.firstPeriod.priceVnd,
          durationSeconds: input.config.firstPeriod.durationSeconds,
          amount: segmentAmount(
            elapsedSeconds,
            input.config.firstPeriod.priceVnd,
            input.config.firstPeriod.durationSeconds,
            input.config.calculationMode,
          ),
        });
        firstRemaining -= elapsedSeconds;
        cursor = endedAtMs;
        continue;
      }

      const local = localTime(cursor, input.config.timezone);
      const window = input.config.specialWindows.find((w) =>
        isSpecialWindowActiveAt(w, local.weekday, local.minute),
      );

      let nextTransitionMinute = 1440;
      for (const w of input.config.specialWindows) {
        if (w.startMinute > local.minute && w.startMinute < nextTransitionMinute) {
          nextTransitionMinute = w.startMinute;
        }
        if (w.endMinute > local.minute && w.endMinute < nextTransitionMinute) {
          nextTransitionMinute = w.endMinute;
        }
      }

      const msIntoMinute = local.second * 1000 + (cursor % 1000);
      const msUntilTransition = (nextTransitionMinute - local.minute) * 60_000 - msIntoMinute;
      const nextBoundaryMs = cursor + Math.max(1000, msUntilTransition);
      const endedAtMs = Math.min(interval.end, nextBoundaryMs);
      const elapsedSeconds = Math.floor((endedAtMs - cursor) / 1000);

      if (elapsedSeconds <= 0) {
        cursor = endedAtMs;
        continue;
      }

      const priceVnd = window?.priceVnd ?? input.config.basePriceVnd;
      drafts.push({
        type: window ? 'SPECIAL' : 'BASE',
        ...(window ? { windowId: window.id } : {}),
        name: window?.name ?? 'Giá thường',
        startedAtMs: cursor,
        endedAtMs,
        elapsedSeconds,
        priceVnd,
        durationSeconds: input.config.baseDurationSeconds,
        amount: segmentAmount(
          elapsedSeconds,
          priceVnd,
          input.config.baseDurationSeconds,
          input.config.calculationMode,
        ),
      });
      cursor = endedAtMs;
    }
  }

  const merged = mergeSegments(drafts, input.config.calculationMode);
  const totalFraction = merged.reduce<Fraction>(
    (total, segment) => addFraction(total, segment.amount),
    { numerator: 0n, denominator: 1n },
  );
  const amountBeforeRoundingVnd = roundHalfUp(totalFraction);
  const initialSegmentAmounts = merged.map((segment) => roundHalfUp(segment.amount));
  const allocationDelta =
    amountBeforeRoundingVnd - initialSegmentAmounts.reduce((sum, amount) => sum + amount, 0);

  const segments: PricingSegment[] = merged.map((segment, index) => {
    const amountBeforeRounding =
      (initialSegmentAmounts[index] ?? 0) +
      (index === initialSegmentAmounts.length - 1 ? allocationDelta : 0);
    const result: PricingSegment = {
      type: segment.type,
      name: segment.name,
      startedAtMs: segment.startedAtMs,
      endedAtMs: segment.endedAtMs,
      elapsedSeconds: segment.elapsedSeconds,
      priceVnd: segment.priceVnd,
      durationSeconds: segment.durationSeconds,
      amountBeforeRoundingVnd: amountBeforeRounding,
    };
    if (segment.windowId) result.windowId = segment.windowId;
    return result;
  });

  return {
    elapsedSeconds: segments.reduce((total, segment) => total + segment.elapsedSeconds, 0),
    amountBeforeRoundingVnd,
    amountAfterRoundingVnd: roundMoney(amountBeforeRoundingVnd, input.config.roundingUnitVnd),
    segments,
  };
}
