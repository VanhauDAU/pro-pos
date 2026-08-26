import type { OwnerQrSalesAvailability } from '@contracts/owner-qr-order';

export interface QrSalesWindow {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
}

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function zonedParts(timestamp: number, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(timestamp);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values['year']),
    month: Number(values['month']),
    day: Number(values['day']),
    weekday: WEEKDAYS[values['weekday'] ?? 'Sun'] ?? 0,
    hour: Number(values['hour']),
    minute: Number(values['minute']),
  };
}

function zonedLocalTimeToUtc(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timeZone: string;
}) {
  const desiredAsUtc = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute);
  let guess = desiredAsUtc;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const actual = zonedParts(guess, input.timeZone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
    );
    guess += desiredAsUtc - actualAsUtc;
  }
  return guess;
}

function nextOpeningAt(now: number, timeZone: string, windows: QrSalesWindow[]) {
  const localNow = zonedParts(now, timeZone);
  const localDate = new Date(Date.UTC(localNow.year, localNow.month - 1, localNow.day));
  let best: number | null = null;
  for (let offset = 0; offset <= 7; offset += 1) {
    const date = new Date(localDate);
    date.setUTCDate(date.getUTCDate() + offset);
    const weekday = (localNow.weekday + offset) % 7;
    for (const window of windows) {
      if (window.weekday !== weekday) continue;
      const candidate = zonedLocalTimeToUtc({
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour: Math.floor(window.startMinute / 60),
        minute: window.startMinute % 60,
        timeZone,
      });
      if (candidate > now && (best === null || candidate < best)) best = candidate;
    }
  }
  return best;
}

export function calculateQrSalesAvailability(input: {
  now?: number;
  timeZone: string;
  scheduleEnabled: boolean;
  manuallyPaused: boolean;
  windows: QrSalesWindow[];
}): OwnerQrSalesAvailability {
  const now = input.now ?? Date.now();
  if (input.manuallyPaused) {
    return {
      acceptingOrders: false,
      manuallyPaused: true,
      scheduleEnabled: input.scheduleEnabled,
      reason: 'MANUALLY_PAUSED',
      nextOpenAt: null,
    };
  }
  if (!input.scheduleEnabled) {
    return {
      acceptingOrders: true,
      manuallyPaused: false,
      scheduleEnabled: false,
      reason: 'OPEN',
      nextOpenAt: null,
    };
  }
  const local = zonedParts(now, input.timeZone);
  const minute = local.hour * 60 + local.minute;
  const acceptingOrders = input.windows.some(
    (window) =>
      window.weekday === local.weekday && window.startMinute <= minute && minute < window.endMinute,
  );
  return {
    acceptingOrders,
    manuallyPaused: false,
    scheduleEnabled: true,
    reason: acceptingOrders ? 'OPEN' : 'OUTSIDE_SCHEDULE',
    nextOpenAt: acceptingOrders ? null : nextOpeningAt(now, input.timeZone, input.windows),
  };
}
