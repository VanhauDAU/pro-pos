PRAGMA foreign_keys = ON;

ALTER TABLE store_settings ADD COLUMN location_verification_enabled INTEGER NOT NULL DEFAULT 0 CHECK (location_verification_enabled IN (0, 1));
ALTER TABLE store_settings ADD COLUMN latitude REAL CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90));
ALTER TABLE store_settings ADD COLUMN longitude REAL CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180));
ALTER TABLE store_settings ADD COLUMN allowed_radius_meters REAL NOT NULL DEFAULT 300 CHECK (allowed_radius_meters >= 30 AND allowed_radius_meters <= 5000);
ALTER TABLE store_settings ADD COLUMN max_accuracy_meters REAL NOT NULL DEFAULT 100 CHECK (max_accuracy_meters >= 20 AND max_accuracy_meters <= 300);

ALTER TABLE guest_order_sessions ADD COLUMN location_verified_at INTEGER;
ALTER TABLE guest_order_sessions ADD COLUMN location_distance_meters REAL;
ALTER TABLE guest_order_sessions ADD COLUMN location_accuracy_meters REAL;
ALTER TABLE guest_order_sessions ADD COLUMN location_expires_at INTEGER;
