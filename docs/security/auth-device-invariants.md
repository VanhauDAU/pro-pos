# Auth và device invariants

## Owner

- `/owner` chỉ yêu cầu Owner session, không yêu cầu device.
- Điện thoại hoặc Windows mới đều có thể Owner login trực tiếp.
- Owner login không tạo device hoặc activation grant.

## POS activation

1. Owner re-auth qua `/device-activations/authorize`.
2. Backend suy ra store từ Owner; request không gửi `store_id` có thẩm quyền.
3. Grant 5 phút, one-time, scope `ACTIVATE_DEVICE`; D1 chỉ lưu hash.
4. Confirm + `Idempotency-Key` tạo đúng một device và secret 256 bit.
5. Setup không tạo Owner session; sau thành công chỉ giữ device cookie.

## Employee

- PIN bắt buộc device/store `ACTIVE`.
- Employee session bound đúng `device_id + store_id`.
- Mọi POS request recheck device; remote revoke có hiệu lực ngay.
- Revoke không tự hủy order/time session đang lưu server-side.

## Cookie production

- `__Host-propos-device`
- `__Host-propos-session`
- `__Host-propos-activation`

Tất cả: `HttpOnly; Secure; SameSite=Lax; Path=/`, không có `Domain`. Logout chỉ clear session.

## PBKDF2 CPU gate

PBKDF2-HMAC-SHA256 dùng `node:crypto` native của Workers, salt riêng, pepper server-side; hash lưu
algorithm, work factor và versions. Không dùng `SubtleCrypto.deriveBits()` cho PBKDF2 vì Workers
runtime từ chối iteration count lớn hơn 100.000. Adapter `node:crypto` giữ nguyên thuật toán và work
factor bảo mật đã chọn, thay vì hạ policy để né giới hạn API này.

Work factor được benchmark trên deployed Worker. Workers Free chỉ được chấp nhận nếu không có error
1102 và P99 auth CPU ≤ 8 ms. Không hạ security baseline để giữ free; mặc định nâng Workers Paid nếu
không đạt.
