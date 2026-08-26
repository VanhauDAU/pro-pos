# D1 migration policy

- `0001_identity_and_access.sql`: store, user, RBAC, credentials, sessions, device/grant, audit.
- `0002_catalog_and_pricing.sql`: settings, area, unit, category, product, pricing, media.
- `0003_pos_and_billing.sql`: table, order, session, payment, invoice và command triggers.
- `0004_access_otp_and_pin_verifiers.sql`: Access identity, request OTP và PIN verifier keyed-HMAC.
- `0005_access_bridge_codes.sql`: identity đã xác thực và hash authorization code one-time cho auth
  bridge exchange.
- `0006_security_tenant_financial_hardening.sql`: one-user-one-store index, accounting snapshots,
  atomic invoice sequence, pause/resume commands và tenant reference guards. Migration này không
  sửa các file 0001–0005; dữ liệu PERCENT lịch sử không thể suy ngược input phần trăm nên giữ
  `discount_input_value` là `NULL`. Backfill tính lại gross từ unit price × quantity và cap
  discount theo gross để không làm phình dữ liệu tài chính lịch sử.
- `0007_owner_store_location.sql`: thêm mã/tên tỉnh và phường/xã để lưu địa chỉ hành chính mới
  của Owner settings.
- `0008_area_table_setup.sql`: bổ sung layout khu vực/bàn phòng và các ràng buộc trạng thái cho POS.
- `0009_staff_roles_permissions.sql`: bổ sung vai trò tùy chỉnh, quyền nhân viên và liên kết user-role.
- `0061_owner_qr_order_settings.sql`: bổ sung trạng thái QR theo bàn, cấu hình cooldown/vị trí và
  lịch bán QR theo cửa hàng, lý do gọi nhân viên có thứ tự, reason snapshot và trigger cooldown
  gọi món động. Migration backfill QR-enabled cùng bốn lý do mặc định cho store hiện có.
- `0062_qr_order_product_visibility.sql`: thêm cờ hiển thị QR Order theo từng mặt hàng; mặc định
  bật để không làm thay đổi thực đơn QR hiện có khi nâng cấp.
- `0063_qr_order_reason_archive_and_variant_visibility.sql`: thêm cờ archive tương thích cho lý do
  gọi nhân viên và chuyển trạng thái hiển thị QR Order xuống từng phiên bản giá.

Quy tắc:

- Forward-only; không sửa/xóa migration đã chạy remote.
- Additive expand trước, code tương thích cũ+mới, contract sau.
- PR phải test database sạch và upgrade từ version trước.
- Trước khi áp dụng `0006`, kiểm tra không có user thuộc nhiều store (`GROUP BY user_id HAVING COUNT(*) > 1`);
  membership trùng tenant phải được xử lý và ghi nhận trước migration vì unique index mới cố ý
  không tự động chọn tenant thay người vận hành.
- Staging migration sau merge `dev`; production migration sau release PR `dev → main`.
- Worker rollback không rollback D1/R2.
- SQL migrations luôn dùng LF (`.gitattributes`). Với D1 triggers, bọc `CASE ... END` trong
  ngoặc để tránh Wrangler/D1 remote parser hiểu nhầm `END` của CASE là cuối trigger.
