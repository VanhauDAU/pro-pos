# ADR-0005: Cloudflare Access email OTP trên Workers Free

Status: Accepted

Supersedes: ADR-0004

## Bối cảnh

Workers Free giới hạn CPU 10 ms/request và workerd từ chối PBKDF2 iteration count lớn hơn 100.000.
Pro POS được dùng trong gia đình và phải vận hành ở mức 0đ; hạ password work factor không được chấp
nhận.

## Quyết định

- Owner và SUPER_ADMIN xác thực bằng Cloudflare Access One-time PIN gửi tới email được phép.
- Chỉ auth bridge Worker `pro-pos-auth-<environment>` được Access bảo vệ; SPA, health và Employee
  POS trên main Worker không bị khóa bởi Access.
- Access xác thực identity ở edge; bridge Worker đọc identity qua `ctx.access`, ghi hash của
  authorization code one-time vào D1 rồi redirect về main Worker. Main Worker bắt buộc ánh xạ email
  với `access_identities` trước khi tạo Pro POS session hoặc activation grant.
- Mỗi flow dùng `__Host-propos-access` và `access_auth_requests` one-time TTL 10 phút để chống login
  CSRF/replay và bind mục đích Owner, platform, activation hoặc device reissue.
- Employee tiếp tục dùng username/PIN trên ACTIVE device. PIN verifier dùng HMAC-SHA256 keyed bằng
  Worker Secret, salt riêng, context user/store và D1 lockout; không dùng password KDF trong Worker.
- D1 vẫn là nguồn sự thật cho tenant, RBAC, device và session. Access chỉ chứng minh email.

## Hệ quả

Auth route còn lại là HMAC/SQL nhẹ và phù hợp Workers Free. Pro POS không lưu Owner/Admin password.
Đổi lại, Owner cần email và phụ thuộc Access/khả năng nhận OTP. Exact-email allow policy phải được
đồng bộ thủ công khi thêm Owner mới. Access SSO có thể tái sử dụng global session, nên dedicated
activation request vẫn one-time nhưng không đảm bảo email OTP được gửi lại nếu Access session còn
hợp lệ.
