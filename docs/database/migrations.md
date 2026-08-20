# D1 migration policy

- `0001_identity_and_access.sql`: store, user, RBAC, credentials, sessions, device/grant, audit.
- `0002_catalog_and_pricing.sql`: settings, area, unit, category, product, pricing, media.
- `0003_pos_and_billing.sql`: table, order, session, payment, invoice và command triggers.

Quy tắc:

- Forward-only; không sửa/xóa migration đã chạy remote.
- Additive expand trước, code tương thích cũ+mới, contract sau.
- PR phải test database sạch và upgrade từ version trước.
- Staging migration sau merge `dev`; production migration sau release PR `dev → main`.
- Worker rollback không rollback D1/R2.
- SQL migrations luôn dùng LF (`.gitattributes`). Với D1 triggers, bọc `CASE ... END` trong
  ngoặc để tránh Wrangler/D1 remote parser hiểu nhầm `END` của CASE là cuối trigger.
