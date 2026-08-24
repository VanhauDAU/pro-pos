PRAGMA foreign_keys = ON;

-- Seed default units of measurement for all existing stores
INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Miligram (mg)', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'miligram (mg)');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Gram (g)', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'gram (g)');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Kilogram (kg)', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'kilogram (kg)');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Phần', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'phần');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Suất', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'suất');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Viên', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'viên');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Miếng', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'miếng');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Cái', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'cái');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Đĩa', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'đĩa');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Chén', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'chén');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Bát', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'bát');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Tô', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'tô');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Hộp', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'hộp');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Khay', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'khay');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Bao', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'bao');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Tá', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'tá');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Milliliter (ml)', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'milliliter (ml)');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Liter (l)', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'liter (l)');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Ly', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'ly');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Cốc', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'cốc');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Tách', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'tách');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Lon', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'lon');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Chai', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'chai');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Bình', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'bình');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Can', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'can');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Lốc', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'lốc');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Pack', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'pack');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Két', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'két');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Thùng', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'thùng');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Lần', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'lần');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Vé', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'vé');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Giờ', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'giờ');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Buổi', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'buổi');

INSERT OR IGNORE INTO units (id, store_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(16))), s.id, 'Gói', s.created_at, s.updated_at
FROM stores s WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.store_id = s.id AND LOWER(units.name) = 'gói');
