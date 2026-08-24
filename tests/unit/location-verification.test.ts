import { describe, expect, it } from 'vitest';

import { verifyGuestLocationSchema } from '../../src/contracts/qr-order';
import { updateStoreSettingsSchema } from '../../src/contracts/store';
import {
  calculateHaversineDistanceMeters,
  verifyLocationCoordinates,
} from '../../src/server/lib/location';

describe('Location math & Haversine formula', () => {
  it('returns 0 meters for identical GPS coordinates', () => {
    const lat = 16.0544;
    const lng = 108.2022;
    expect(calculateHaversineDistanceMeters(lat, lng, lat, lng)).toBe(0);
  });

  it('calculates accurate distance between known geographic points', () => {
    // Da Nang Dragon Bridge (16.0610, 108.2208) to My Khe Beach (16.0601, 108.2464) ~2.7km
    const dist = calculateHaversineDistanceMeters(16.061, 108.2208, 16.0601, 108.2464);
    expect(dist).toBeGreaterThan(2700);
    expect(dist).toBeLessThan(2800);
  });

  it('calculates short distances in meters accurately (e.g. ~50m to ~300m)', () => {
    const lat1 = 16.0544;
    const lon1 = 108.2022;
    // ~111m north (0.001 deg latitude)
    const lat2 = 16.0554;
    const lon2 = 108.2022;
    const dist = calculateHaversineDistanceMeters(lat1, lon1, lat2, lon2);
    expect(dist).toBeGreaterThan(110);
    expect(dist).toBeLessThan(113);
  });
});

describe('verifyLocationCoordinates core engine', () => {
  const storeCoords = {
    locationVerificationEnabled: true,
    latitude: 16.0544,
    longitude: 108.2022,
    allowedRadiusMeters: 300,
    maxAccuracyMeters: 100,
  };
  const serverNow = 1700000000000;

  it('bypasses check when location verification is disabled on store', () => {
    const result = verifyLocationCoordinates({
      storeSettings: {
        ...storeCoords,
        locationVerificationEnabled: false,
      },
      input: {
        latitude: 21.0285, // Hanoi (~600km away)
        longitude: 105.8542,
        accuracyMeters: 20,
      },
      serverNow,
    });
    expect(result.verified).toBe(true);
    expect(result.distanceMeters).toBe(0);
    expect(result.expiresAt).toBe(serverNow + 15 * 60_000);
  });

  it('throws STORE_LOCATION_NOT_CONFIGURED if store coordinates are null when enabled', () => {
    expect(() =>
      verifyLocationCoordinates({
        storeSettings: {
          ...storeCoords,
          latitude: null,
          longitude: null,
        },
        input: {
          latitude: 16.0544,
          longitude: 108.2022,
          accuracyMeters: 20,
        },
        serverNow,
      }),
    ).toThrowError('Cửa hàng chưa thiết lập tọa độ');
  });

  it('throws LOCATION_TIMESTAMP_INVALID if client capturedAt is more than 5 minutes old', () => {
    expect(() =>
      verifyLocationCoordinates({
        storeSettings: storeCoords,
        input: {
          latitude: 16.0544,
          longitude: 108.2022,
          accuracyMeters: 20,
          capturedAt: serverNow - 6 * 60_000,
        },
        serverNow,
      }),
    ).toThrowError('Tọa độ vị trí đã quá cũ');
  });

  it('throws LOCATION_TOO_INACCURATE if accuracyMeters exceeds store maxAccuracyMeters', () => {
    expect(() =>
      verifyLocationCoordinates({
        storeSettings: storeCoords,
        input: {
          latitude: 16.0544,
          longitude: 108.2022,
          accuracyMeters: 150, // > 100 max
        },
        serverNow,
      }),
    ).toThrowError('Độ chính xác vị trí GPS quá thấp');
  });

  it('throws LOCATION_OUTSIDE_ALLOWED_RADIUS if client is beyond allowed radius', () => {
    // Coordinates ~500m away
    const farLat = 16.059;
    const farLng = 108.2022;
    expect(() =>
      verifyLocationCoordinates({
        storeSettings: storeCoords,
        input: {
          latitude: farLat,
          longitude: farLng,
          accuracyMeters: 25,
        },
        serverNow,
      }),
    ).toThrowError('nằm ngoài bán kính cho phép');
  });

  it('accepts valid GPS reading within allowed radius and returns 15m server TTL', () => {
    // 50m away with good 15m accuracy
    const closeLat = 16.0548;
    const closeLng = 108.2022;
    const result = verifyLocationCoordinates({
      storeSettings: storeCoords,
      input: {
        latitude: closeLat,
        longitude: closeLng,
        accuracyMeters: 15,
        capturedAt: serverNow - 1000,
      },
      serverNow,
    });

    expect(result.verified).toBe(true);
    expect(result.distanceMeters).toBeGreaterThan(40);
    expect(result.distanceMeters).toBeLessThan(60);
    expect(result.allowedRadiusMeters).toBe(300);
    expect(result.accuracyMeters).toBe(15);
    expect(result.verifiedAt).toBe(serverNow);
    expect(result.expiresAt).toBe(serverNow + 15 * 60_000);
  });
});

describe('Store Settings & Location Zod schema validation', () => {
  it('rejects store update if location verification enabled without coordinates', () => {
    const invalidInput = {
      name: 'Billiard Club',
      address: '123 Le Duan',
      businessDayCutoffMinutes: 0,
      locationVerificationEnabled: true,
      latitude: null,
      longitude: null,
    };
    const parsed = updateStoreSettingsSchema.safeParse(invalidInput);
    expect(parsed.success).toBe(false);
  });

  it('accepts store update with valid location configuration and coordinates', () => {
    const validInput = {
      name: 'Billiard Club',
      address: '123 Le Duan',
      businessDayCutoffMinutes: 0,
      locationVerificationEnabled: true,
      latitude: 16.0544,
      longitude: 108.2022,
      allowedRadiusMeters: 300,
      maxAccuracyMeters: 100,
    };
    const parsed = updateStoreSettingsSchema.safeParse(validInput);
    expect(parsed.success).toBe(true);
  });

  it('validates verifyGuestLocationSchema for guest coordinates payload', () => {
    const validGuestPayload = {
      latitude: 16.0544,
      longitude: 108.2022,
      accuracyMeters: 15,
      capturedAt: Date.now(),
    };
    const parsed = verifyGuestLocationSchema.safeParse(validGuestPayload);
    expect(parsed.success).toBe(true);
  });
});
