-- Fine-grained roles used to receive broad runtime permissions automatically.
-- Remove only those derived grants; legacy roles that contain only a broad
-- permission keep their existing behavior.
DELETE FROM role_permissions
WHERE permission_key = 'order.manage'
  AND role_id IN (SELECT id FROM roles WHERE code <> 'OWNER')
  AND EXISTS (
    SELECT 1
    FROM role_permissions selected
    WHERE selected.store_id = role_permissions.store_id
      AND selected.role_id = role_permissions.role_id
      AND selected.permission_key = 'order.create'
  );

DELETE FROM role_permissions
WHERE permission_key = 'catalog.manage'
  AND role_id IN (SELECT id FROM roles WHERE code <> 'OWNER')
  AND EXISTS (
    SELECT 1
    FROM role_permissions selected
    WHERE selected.store_id = role_permissions.store_id
      AND selected.role_id = role_permissions.role_id
      AND (
        selected.permission_key LIKE 'catalog.products.%'
        OR selected.permission_key LIKE 'catalog.categories.%'
      )
  );

DELETE FROM role_permissions
WHERE permission_key = 'staff.manage'
  AND role_id IN (SELECT id FROM roles WHERE code <> 'OWNER')
  AND EXISTS (
    SELECT 1
    FROM role_permissions selected
    WHERE selected.store_id = role_permissions.store_id
      AND selected.role_id = role_permissions.role_id
      AND selected.permission_key LIKE 'staff.employees.%'
  );
