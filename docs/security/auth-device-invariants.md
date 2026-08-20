# Auth và device invariants

## Owner

- `/owner` chỉ yêu cầu Owner session, không yêu cầu device.
- Điện thoại hoặc Windows mới đều có thể Owner login trực tiếp.
- Owner login không tạo device hoặc activation grant.
- Owner và SUPER_ADMIN xác thực bằng email OTP của Cloudflare Access; Pro POS không nhận hoặc lưu
  password của hai loại tài khoản này.
- Callback Access chỉ cấp session khi email đã có trong `access_identities` và user/store còn active.

## POS activation

1. UI tạo Access request one-time rồi điều hướng tới callback được Cloudflare Access bảo vệ.
2. Cloudflare xác thực email; backend suy ra Owner/store từ D1, không nhận `store_id` từ client.
3. Grant 5 phút, one-time, scope `ACTIVATE_DEVICE`; D1 chỉ lưu hash.
4. Confirm + `Idempotency-Key` tạo đúng một device và secret 256 bit.
5. Setup không tạo Owner session; sau thành công chỉ giữ device cookie.
6. Fresh POS luôn phải qua Access. Nếu trình duyệt còn global Access session, Cloudflare có thể dùng
   SSO thay vì gửi OTP mới; Access request nội bộ vẫn one-time và chỉ dùng cho activation.

## Employee

- PIN bắt buộc device/store `ACTIVE`.
- PIN lưu bằng keyed verifier `HMAC-SHA256` với salt, context user/store và Worker Secret pepper;
  D1 không đủ để kiểm tra PIN nếu thiếu pepper.
- Sai 5 lần trong cửa sổ 10 phút khóa 15 phút theo device + username.
- Employee session bound đúng `device_id + store_id`.
- Mọi POS request recheck device; remote revoke có hiệu lực ngay.
- Revoke không tự hủy order/time session đang lưu server-side.

## Cookie production

- `__Host-propos-device`
- `__Host-propos-session`
- `__Host-propos-activation`
- `__Host-propos-access`

Tất cả: `HttpOnly; Secure; SameSite=Lax; Path=/`, không có `Domain`. Logout chỉ clear Pro POS
session; Access session được quản lý riêng bởi Cloudflare.

## Workers Free CPU gate

Worker không chạy password KDF. Access xử lý Owner/Admin OTP; Employee PIN chỉ cần HMAC native và
constant-time comparison. Staging vẫn phải theo dõi error 1102 và P99 auth CPU ≤ 8 ms.
