import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';

describe('StaffDateTimeInput logic', () => {
  it('formats date and time correctly for Vietnamese locale display', () => {
    const dt = dayjs('2026-09-04T14:35:20');
    expect(dt.format('DD/MM/YYYY')).toBe('04/09/2026');
    expect(dt.format('HH:mm')).toBe('14:35');
    expect(dt.format('YYYY-MM-DD')).toBe('2026-09-04');
  });

  it('updates date while preserving existing time', () => {
    const base = dayjs('2026-09-04T14:35:00');
    const parts = '2026-09-03'.split('-').map(Number);
    const year = parts[0]!;
    const month = parts[1]!;
    const day = parts[2]!;
    const next = base
      .clone()
      .year(year)
      .month(month - 1)
      .date(day);

    expect(next.format('YYYY-MM-DD')).toBe('2026-09-03');
    expect(next.format('HH:mm')).toBe('14:35');
  });

  it('updates time while preserving existing date', () => {
    const base = dayjs('2026-09-04T14:35:00');
    const parts = '16:45'.split(':').map(Number);
    const hours = parts[0]!;
    const minutes = parts[1]!;
    const next = base.clone().hour(hours).minute(minutes).second(0);

    expect(next.format('YYYY-MM-DD')).toBe('2026-09-04');
    expect(next.format('HH:mm')).toBe('16:45');
    expect(next.second()).toBe(0);
  });

  it('calculates duration correctly between startedAt and endedAt', () => {
    const start = dayjs('2026-09-04T14:00:00');
    const end = dayjs('2026-09-04T16:30:00');

    const durationSeconds = Math.floor((end.valueOf() - start.valueOf()) / 1000);
    expect(durationSeconds).toBe(9000); // 2 hours 30 mins = 150 mins = 9000s

    const hours = Math.floor(durationSeconds / 3600);
    const minutes = Math.floor((durationSeconds % 3600) / 60);
    const seconds = durationSeconds % 60;
    const formatted = [hours, minutes, seconds].map((v) => String(v).padStart(2, '0')).join(':');
    expect(formatted).toBe('02:30:00');
  });
});
