# ADR-0004: Portable PBKDF2 và Workers Paid cho auth

Status: Accepted

Supersedes: ADR-0003

## Bối cảnh

Staging edge xác nhận cả `SubtleCrypto.deriveBits()` và `node:crypto.pbkdf2()` của Workers đều từ
chối PBKDF2 iteration count lớn hơn 100.000. Miniflare local không tái hiện giới hạn edge này, nên
integration test trước đó đã cho kết quả dương tính giả. Giới hạn đang được theo dõi tại
[cloudflare/workerd#1346](https://github.com/cloudflare/workerd/issues/1346).

Policy Pro POS hiện yêu cầu PBKDF2-HMAC-SHA256 với work factor 600.000. Hạ xuống 100.000 để giữ
Workers Free sẽ trái security gate đã khóa.

## Quyết định

- Dùng PBKDF2-HMAC-SHA256 portable của
  [`@noble/hashes`](https://github.com/paulmillr/noble-hashes), một implementation tối giản đã được
  audit và tuân theo RFC 2898.
- Giữ nguyên password + NUL + pepper, salt, output 32 byte và work factor lưu theo credential.
- Dùng test vector tạo độc lập bằng Node.js/OpenSSL để phát hiện sai lệch thuật toán.
- Auth workload với work factor 600.000 yêu cầu Workers Paid, trừ khi benchmark edge chứng minh một
  môi trường khác đáp ứng security target và CPU gate.
- Không cho phép hạ work factor chỉ để bootstrap chạy trên Free.

## Hệ quả

Digest không phụ thuộc PBKDF2 API bị giới hạn của Workers và vẫn tương thích với implementation
PBKDF2-HMAC-SHA256 tiêu chuẩn. Đổi lại, implementation JavaScript dùng nhiều CPU hơn native crypto;
phải benchmark trên staging và theo dõi error 1102 trước pilot.
