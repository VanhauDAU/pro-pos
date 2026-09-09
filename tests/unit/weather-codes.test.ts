import { describe, expect, it } from 'vitest';
import { mapWmoCode } from '@server/integrations/weather/weather-codes';

describe('WMO Weather Codes Mapper', () => {
  it('maps code 0 (Clear sky) correctly for day and night', () => {
    const day = mapWmoCode(0, true);
    expect(day.icon).toBe('SUN');
    expect(day.label).toBe('Trời quang');

    const night = mapWmoCode(0, false);
    expect(night.icon).toBe('MOON');
    expect(night.label).toBe('Trời quang');
  });

  it('maps partly cloudy codes (1, 2) with day/night variants', () => {
    const code1Day = mapWmoCode(1, true);
    expect(code1Day.icon).toBe('PARTLY_CLOUDY_DAY');
    expect(code1Day.label).toBe('Ít mây');

    const code1Night = mapWmoCode(1, false);
    expect(code1Night.icon).toBe('PARTLY_CLOUDY_NIGHT');

    const code2Day = mapWmoCode(2, true);
    expect(code2Day.icon).toBe('PARTLY_CLOUDY_DAY');
  });

  it('maps overcast code 3 to CLOUDY', () => {
    const result = mapWmoCode(3);
    expect(result.icon).toBe('CLOUDY');
    expect(result.label).toBe('Nhiều mây');
  });

  it('maps fog codes (45, 48)', () => {
    expect(mapWmoCode(45).icon).toBe('FOG');
    expect(mapWmoCode(48).icon).toBe('FOG');
  });

  it('maps drizzle codes (51, 53, 55, 56, 57)', () => {
    expect(mapWmoCode(51).icon).toBe('DRIZZLE');
    expect(mapWmoCode(53).icon).toBe('DRIZZLE');
    expect(mapWmoCode(55).icon).toBe('DRIZZLE');
    expect(mapWmoCode(56).icon).toBe('DRIZZLE');
  });

  it('maps rain codes (61, 63, 65, 66, 67)', () => {
    expect(mapWmoCode(61).icon).toBe('RAIN');
    expect(mapWmoCode(63).icon).toBe('RAIN');
    expect(mapWmoCode(65).icon).toBe('RAIN');
  });

  it('maps rain shower codes (80, 81, 82)', () => {
    expect(mapWmoCode(80).icon).toBe('RAIN_SHOWERS');
    expect(mapWmoCode(81).icon).toBe('RAIN_SHOWERS');
    expect(mapWmoCode(82).icon).toBe('RAIN_SHOWERS');
  });

  it('maps thunderstorm codes (95, 96, 99)', () => {
    expect(mapWmoCode(95).icon).toBe('THUNDERSTORM');
    expect(mapWmoCode(96).icon).toBe('THUNDERSTORM');
    expect(mapWmoCode(99).icon).toBe('THUNDERSTORM');
  });

  it('maps snow codes (71, 73, 75, 77, 85, 86)', () => {
    expect(mapWmoCode(71).icon).toBe('SNOW');
    expect(mapWmoCode(73).icon).toBe('SNOW');
    expect(mapWmoCode(75).icon).toBe('SNOW');
    expect(mapWmoCode(85).icon).toBe('SNOW');
  });

  it('provides safe fallback for unknown weather codes', () => {
    const fallback = mapWmoCode(999, true);
    expect(fallback.icon).toBe('SUN');
    expect(fallback.label).toBe('Thời tiết không xác định');
  });
});
