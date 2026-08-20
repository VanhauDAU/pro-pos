# ADR-0003: PBKDF2 qua Workers Node Crypto

Status: Accepted

## Bối cảnh

Credential policy của Pro POS dùng PBKDF2-HMAC-SHA256 với work factor lưu theo từng credential.
Workers `SubtleCrypto.deriveBits()` từ chối PBKDF2 iteration count lớn hơn 100.000, trong khi policy
hiện tại là 600.000. Hạ policy xuống giới hạn này chỉ để bootstrap chạy sẽ làm yếu thiết kế bảo mật.

Cloudflare hỗ trợ native `node:crypto` trong Workers và mô tả module này là được hỗ trợ đầy đủ, trừ
một số API không liên quan đến PBKDF2:
[Cloudflare Workers Node.js crypto](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/).

## Quyết định

- Dùng callback `node:crypto.pbkdf2` với SHA-256 và output 32 byte trong crypto adapter.
- Giữ nguyên salt riêng, server-side pepper, work factor và credential version đang lưu trong D1.
- Thêm integration test chạy trên Workers test runtime với work factor lớn hơn 100.000.
- Tiếp tục đo `$workers.cpuTimeMs` trên staging. Thay adapter không miễn trừ CPU gate.

## Hệ quả

Credential vẫn là PBKDF2-HMAC-SHA256 tiêu chuẩn và không bị khóa ở mức 100.000 của Web Crypto.
Workers Free vẫn có thể không đủ CPU cho work factor bảo mật; nếu P99 vượt gate hoặc có error 1102,
phải nâng Workers Paid theo kế hoạch, không giảm work factor tùy tiện.
