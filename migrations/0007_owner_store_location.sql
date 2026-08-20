PRAGMA foreign_keys = ON;

ALTER TABLE store_settings ADD COLUMN province_code INTEGER;
ALTER TABLE store_settings ADD COLUMN province_name TEXT;
ALTER TABLE store_settings ADD COLUMN ward_code INTEGER;
ALTER TABLE store_settings ADD COLUMN ward_name TEXT;
