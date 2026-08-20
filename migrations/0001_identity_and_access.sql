PRAGMA foreign_keys = ON;

CREATE TABLE stores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'LOCKED')),
  timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  platform_role TEXT CHECK (platform_role IN ('SUPER_ADMIN') OR platform_role IS NULL),
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  email TEXT COLLATE NOCASE,
  phone TEXT,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')),
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (store_id, code)
);

CREATE TABLE permissions (
  key TEXT PRIMARY KEY,
  group_key TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE role_permissions (
  store_id TEXT NOT NULL REFERENCES stores(id),
  role_id TEXT NOT NULL REFERENCES roles(id),
  permission_key TEXT NOT NULL REFERENCES permissions(key),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (store_id, role_id, permission_key)
);

CREATE TABLE store_memberships (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role_id TEXT NOT NULL REFERENCES roles(id),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (store_id, user_id)
);

CREATE TABLE password_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  algorithm TEXT NOT NULL CHECK (algorithm = 'PBKDF2-HMAC-SHA256'),
  work_factor INTEGER NOT NULL CHECK (work_factor > 0),
  salt TEXT NOT NULL,
  digest TEXT NOT NULL,
  pepper_version INTEGER NOT NULL CHECK (pepper_version > 0),
  credential_version INTEGER NOT NULL CHECK (credential_version > 0),
  updated_at INTEGER NOT NULL
);

CREATE TABLE pin_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  store_id TEXT NOT NULL REFERENCES stores(id),
  algorithm TEXT NOT NULL CHECK (algorithm = 'PBKDF2-HMAC-SHA256'),
  work_factor INTEGER NOT NULL CHECK (work_factor > 0),
  salt TEXT NOT NULL,
  digest TEXT NOT NULL,
  pepper_version INTEGER NOT NULL CHECK (pepper_version > 0),
  credential_version INTEGER NOT NULL CHECK (credential_version > 0),
  updated_at INTEGER NOT NULL
);

CREATE TABLE login_attempts (
  scope TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 0,
  window_started_at INTEGER NOT NULL,
  locked_until INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (scope, subject_key)
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  activated_by TEXT NOT NULL REFERENCES users(id),
  activated_at INTEGER NOT NULL,
  revoked_at INTEGER,
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE device_credentials (
  device_id TEXT PRIMARY KEY REFERENCES devices(id),
  secret_hash TEXT NOT NULL,
  pepper_version INTEGER NOT NULL CHECK (pepper_version > 0),
  credential_version INTEGER NOT NULL CHECK (credential_version > 0),
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE activation_grants (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  store_id TEXT NOT NULL REFERENCES stores(id),
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  scope TEXT NOT NULL CHECK (scope = 'ACTIVATE_DEVICE'),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'CONSUMED', 'EXPIRED', 'CANCELLED')),
  idempotency_key TEXT,
  device_name TEXT,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id),
  store_id TEXT REFERENCES stores(id),
  device_id TEXT REFERENCES devices(id),
  session_kind TEXT NOT NULL CHECK (session_kind IN ('SUPER_ADMIN', 'OWNER', 'EMPLOYEE')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'EXPIRED', 'REVOKED')),
  credential_version INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  idle_expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  store_id TEXT REFERENCES stores(id),
  actor_user_id TEXT REFERENCES users(id),
  actor_session_id TEXT REFERENCES auth_sessions(id),
  device_id TEXT REFERENCES devices(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  request_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_memberships_store_status ON store_memberships(store_id, status);
CREATE INDEX idx_sessions_token_status ON auth_sessions(token_hash, status);
CREATE INDEX idx_sessions_device_status ON auth_sessions(device_id, status);
CREATE INDEX idx_devices_store_status ON devices(store_id, status);
CREATE INDEX idx_activation_grants_token_status ON activation_grants(token_hash, status);
CREATE INDEX idx_audit_store_created ON audit_logs(store_id, created_at);

INSERT INTO permissions (key, group_key, description) VALUES
  ('store.manage', 'store', 'Quản lý thông tin cửa hàng'),
  ('staff.manage', 'staff', 'Quản lý nhân viên và phân quyền'),
  ('device.manage', 'device', 'Quản lý thiết bị POS'),
  ('catalog.manage', 'catalog', 'Quản lý danh mục, đơn vị và mặt hàng'),
  ('pricing.manage', 'pricing', 'Quản lý bảng giá thời gian'),
  ('table.view', 'table', 'Xem khu vực và trạng thái bàn'),
  ('table.manage', 'table', 'Quản lý khu vực và bàn'),
  ('table.open', 'table', 'Mở bàn'),
  ('table.transfer', 'table', 'Chuyển bàn'),
  ('order.manage', 'order', 'Thêm, sửa và hủy món'),
  ('time.pause', 'order', 'Tạm dừng và tiếp tục tính giờ'),
  ('discount.apply', 'checkout', 'Áp dụng giảm giá thủ công'),
  ('checkout.complete', 'checkout', 'Thanh toán và hoàn tất đơn'),
  ('invoice.view', 'invoice', 'Xem phiếu bán hàng'),
  ('invoice.print', 'invoice', 'In phiếu bán hàng'),
  ('audit.view', 'audit', 'Xem nhật ký hoạt động');
