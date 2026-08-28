PRAGMA foreign_keys = ON;

ALTER TABLE store_settings
  ADD COLUMN employee_remember_session_hours INTEGER NOT NULL DEFAULT 12
  CHECK (employee_remember_session_hours BETWEEN 1 AND 720);
