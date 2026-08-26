import { describe, expect, it } from 'vitest';

import { updateOwnerQrOrderSettingsSchema } from '@contracts/owner-qr-order';
import { calculateQrSalesAvailability } from '@server/lib/qr-sales';

const baseSettings = {
  locationVerificationEnabled: false,
  latitude: null,
  longitude: null,
  allowedRadiusMeters: 300,
  maxAccuracyMeters: 100,
  locationMemoryMinutes: 60,
  orderCooldownSeconds: 3,
  callStaffCooldownSeconds: 60,
  checkoutCooldownSeconds: 60,
  salesScheduleEnabled: true,
};

describe('QR Order sales availability', () => {
  it('opens inside a configured store-local window', () => {
    const result = calculateQrSalesAvailability({
      now: Date.parse('2026-08-31T02:00:00.000Z'),
      timeZone: 'Asia/Ho_Chi_Minh',
      scheduleEnabled: true,
      manuallyPaused: false,
      windows: [{ weekday: 1, startMinute: 8 * 60, endMinute: 10 * 60 }],
    });
    expect(result.acceptingOrders).toBe(true);
    expect(result.reason).toBe('OPEN');
  });

  it('calculates the next opening in the store timezone', () => {
    const result = calculateQrSalesAvailability({
      now: Date.parse('2026-08-31T05:00:00.000Z'),
      timeZone: 'Asia/Ho_Chi_Minh',
      scheduleEnabled: true,
      manuallyPaused: false,
      windows: [{ weekday: 2, startMinute: 8 * 60, endMinute: 10 * 60 }],
    });
    expect(result.acceptingOrders).toBe(false);
    expect(result.reason).toBe('OUTSIDE_SCHEDULE');
    expect(result.nextOpenAt).toBe(Date.parse('2026-09-01T01:00:00.000Z'));
  });

  it('keeps manual pause authoritative and resumes to the schedule', () => {
    const paused = calculateQrSalesAvailability({
      now: Date.parse('2026-08-31T02:00:00.000Z'),
      timeZone: 'Asia/Ho_Chi_Minh',
      scheduleEnabled: true,
      manuallyPaused: true,
      windows: [{ weekday: 1, startMinute: 8 * 60, endMinute: 10 * 60 }],
    });
    expect(paused).toMatchObject({ acceptingOrders: false, reason: 'MANUALLY_PAUSED' });

    const outsideSchedule = calculateQrSalesAvailability({
      now: Date.parse('2026-08-31T12:00:00.000Z'),
      timeZone: 'Asia/Ho_Chi_Minh',
      scheduleEnabled: true,
      manuallyPaused: false,
      windows: [{ weekday: 1, startMinute: 8 * 60, endMinute: 10 * 60 }],
    });
    expect(outsideSchedule).toMatchObject({
      acceptingOrders: false,
      reason: 'OUTSIDE_SCHEDULE',
    });
  });

  it('supports an overnight schedule represented as two adjacent day windows', () => {
    const windows = [
      { weekday: 1, startMinute: 22 * 60, endMinute: 1440 },
      { weekday: 2, startMinute: 0, endMinute: 2 * 60 },
    ];
    expect(
      calculateQrSalesAvailability({
        now: Date.parse('2026-08-31T16:30:00.000Z'),
        timeZone: 'Asia/Ho_Chi_Minh',
        scheduleEnabled: true,
        manuallyPaused: false,
        windows,
      }).acceptingOrders,
    ).toBe(true);
    expect(
      updateOwnerQrOrderSettingsSchema.safeParse({
        ...baseSettings,
        salesHours: windows,
      }).success,
    ).toBe(true);
  });

  it('rejects overlapping windows and more than four windows per day', () => {
    const overlapping = updateOwnerQrOrderSettingsSchema.safeParse({
      ...baseSettings,
      salesHours: [
        { weekday: 1, startMinute: 480, endMinute: 600 },
        { weekday: 1, startMinute: 590, endMinute: 660 },
      ],
    });
    expect(overlapping.success).toBe(false);

    const tooMany = updateOwnerQrOrderSettingsSchema.safeParse({
      ...baseSettings,
      salesHours: Array.from({ length: 5 }, (_, index) => ({
        weekday: 1,
        startMinute: index * 100,
        endMinute: index * 100 + 50,
      })),
    });
    expect(tooMany.success).toBe(false);
  });
});
