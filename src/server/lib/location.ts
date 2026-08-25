import type { VerifyGuestLocationInput } from '@contracts/qr-order';
import { AppError } from '@server/lib/app-error';

const EARTH_RADIUS_METERS = 6371000;
const MAX_ALLOWED_TIMESTAMP_DRIFT_MS = 5 * 60_000; // 5 minutes max GPS reading age/drift

/**
 * Calculates great-circle distance between two GPS coordinates using the Haversine formula.
 * Returns distance rounded in meters.
 */
export function calculateHaversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const radLat1 = (lat1 * Math.PI) / 180;
  const radLat2 = (lat2 * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(radLat1) * Math.cos(radLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(EARTH_RADIUS_METERS * c * 10) / 10;
}

export interface StoreLocationVerificationSettings {
  locationVerificationEnabled: boolean;
  latitude: number | null;
  longitude: number | null;
  allowedRadiusMeters: number;
  maxAccuracyMeters: number;
}

export interface LocationVerificationResult {
  verified: boolean;
  distanceMeters: number;
  allowedRadiusMeters: number;
  accuracyMeters: number;
  verifiedAt: number;
  expiresAt: number;
}

export const LOCATION_VERIFICATION_SESSION_TTL_MS = 60 * 60_000; // 60 minutes (1 hour)

/**
 * Core verification engine for GPS coordinates.
 * Validates store configuration, GPS timestamp freshness, accuracy threshold, and radial proximity.
 */
export function verifyLocationCoordinates(params: {
  storeSettings: StoreLocationVerificationSettings;
  input: VerifyGuestLocationInput;
  serverNow: number;
  sessionTtlMs?: number;
}): LocationVerificationResult {
  const {
    storeSettings,
    input,
    serverNow,
    sessionTtlMs = LOCATION_VERIFICATION_SESSION_TTL_MS,
  } = params;

  // 1. If feature is disabled, bypass check
  if (!storeSettings.locationVerificationEnabled) {
    return {
      verified: true,
      distanceMeters: 0,
      allowedRadiusMeters: storeSettings.allowedRadiusMeters,
      accuracyMeters: input.accuracyMeters,
      verifiedAt: serverNow,
      expiresAt: serverNow + sessionTtlMs,
    };
  }

  // 2. Validate store configuration
  if (
    storeSettings.latitude === null ||
    storeSettings.latitude === undefined ||
    storeSettings.longitude === null ||
    storeSettings.longitude === undefined
  ) {
    throw new AppError(
      'STORE_LOCATION_NOT_CONFIGURED',
      'Cửa hàng chưa thiết lập tọa độ vị trí để xác minh QR Order.',
      409,
    );
  }

  // 3. Validate timestamp freshness (prevent replay attack with old GPS captures)
  if (input.capturedAt) {
    const ageMs = Math.abs(serverNow - input.capturedAt);
    if (ageMs > MAX_ALLOWED_TIMESTAMP_DRIFT_MS) {
      throw new AppError(
        'LOCATION_TIMESTAMP_INVALID',
        'Tọa độ vị trí đã quá cũ hoặc không hợp lệ. Vui lòng lấy lại vị trí hiện tại.',
        422,
        { capturedAt: input.capturedAt, serverNow, ageMs },
      );
    }
  }

  // 4. Validate GPS accuracy threshold (higher accuracyMeters = worse accuracy)
  if (input.accuracyMeters > storeSettings.maxAccuracyMeters) {
    throw new AppError(
      'LOCATION_TOO_INACCURATE',
      `Độ chính xác vị trí GPS quá thấp (~${Math.round(input.accuracyMeters)}m > giới hạn ${storeSettings.maxAccuracyMeters}m). Vui lòng bật định vị chính xác cao và thử lại.`,
      422,
      {
        accuracyMeters: input.accuracyMeters,
        maxAccuracyMeters: storeSettings.maxAccuracyMeters,
      },
    );
  }

  // 5. Calculate Haversine distance
  const distanceMeters = calculateHaversineDistanceMeters(
    storeSettings.latitude,
    storeSettings.longitude,
    input.latitude,
    input.longitude,
  );

  // 6. Check radial distance threshold
  if (distanceMeters > storeSettings.allowedRadiusMeters) {
    throw new AppError(
      'LOCATION_OUTSIDE_ALLOWED_RADIUS',
      `Vị trí của bạn (khoảng cách ~${Math.round(distanceMeters)}m) nằm ngoài bán kính cho phép của cửa hàng (${storeSettings.allowedRadiusMeters}m).`,
      403,
      {
        distanceMeters,
        allowedRadiusMeters: storeSettings.allowedRadiusMeters,
      },
    );
  }

  return {
    verified: true,
    distanceMeters,
    allowedRadiusMeters: storeSettings.allowedRadiusMeters,
    accuracyMeters: input.accuracyMeters,
    verifiedAt: serverNow,
    expiresAt: serverNow + sessionTtlMs,
  };
}
