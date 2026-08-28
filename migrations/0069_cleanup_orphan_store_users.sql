PRAGMA defer_foreign_keys = ON;

-- Store deletion versions before 0069 removed the store first and then silently
-- ignored failures while deleting its users. Clean identity rows for accounts
-- that no longer belong to any store while always preserving SUPER_ADMIN users.
DELETE FROM auth_sessions
WHERE user_id IN (
  SELECT u.id
  FROM users u
  WHERE u.platform_role IS NULL
    AND NOT EXISTS (SELECT 1 FROM store_memberships sm WHERE sm.user_id = u.id)
);

DELETE FROM pin_credentials
WHERE user_id IN (
  SELECT u.id
  FROM users u
  WHERE u.platform_role IS NULL
    AND NOT EXISTS (SELECT 1 FROM store_memberships sm WHERE sm.user_id = u.id)
);

DELETE FROM pin_verifiers
WHERE user_id IN (
  SELECT u.id
  FROM users u
  WHERE u.platform_role IS NULL
    AND NOT EXISTS (SELECT 1 FROM store_memberships sm WHERE sm.user_id = u.id)
);

DELETE FROM store_employee_usernames
WHERE user_id IN (
  SELECT u.id
  FROM users u
  WHERE u.platform_role IS NULL
    AND NOT EXISTS (SELECT 1 FROM store_memberships sm WHERE sm.user_id = u.id)
);

DELETE FROM password_credentials
WHERE user_id IN (
  SELECT u.id
  FROM users u
  WHERE u.platform_role IS NULL
    AND NOT EXISTS (SELECT 1 FROM store_memberships sm WHERE sm.user_id = u.id)
);

DELETE FROM access_identities
WHERE user_id IN (
  SELECT u.id
  FROM users u
  WHERE u.platform_role IS NULL
    AND NOT EXISTS (SELECT 1 FROM store_memberships sm WHERE sm.user_id = u.id)
);

DELETE FROM users
WHERE platform_role IS NULL
  AND NOT EXISTS (SELECT 1 FROM store_memberships sm WHERE sm.user_id = users.id);

PRAGMA defer_foreign_keys = OFF;
