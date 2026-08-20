# Kiến trúc hệ thống

```text
Windows/iPhone/Android Browser
        │
        ├── same-origin HTTPS + HttpOnly cookies ──► Main Worker + Static Assets
        │                                                │
        │                                                ├── D1: tenant/auth/catalog/POS/
        │                                                │       payment/invoice/audit
        │                                                └── R2: private media objects
        │
        └── Owner/SUPER_ADMIN OTP ──► Cloudflare Access ──► Auth bridge Worker
                                                                  │
                                                                  └── same D1
                                                                       │ one-time code
                                                                       ▼
                                                                  Main Worker callback
```

Main Worker không nằm sau Cloudflare Access để Employee PIN, health check và App Shell không bị
buộc đăng nhập email. Auth bridge chỉ nhận `GET /complete`, lấy identity đã được Access xác thực,
ghi hash authorization code one-time vào D1 và redirect về callback của main Worker. Main Worker
đổi code, đối chiếu identity/role/store trong D1 rồi mới cấp session hoặc activation grant.

## Code boundary

`route → middleware → service → repository → D1/R2 binding`

- `src/contracts`: Zod/DTO/enums.
- `src/domain`: pure state/pricing logic.
- `src/server`: trust boundary và adapters.
- `src/access-worker`: trust boundary nhỏ dành riêng cho Cloudflare Access identity.
- `src/client`: untrusted intent/UI.

Mọi query nghiệp vụ nhận store context từ session/device đã xác thực. Worker không dùng Cloudflare
REST API cho D1/R2; chỉ dùng bindings. Không có request-scoped mutable global state.

## Trạng thái chính

- Table: `AVAILABLE | OCCUPIED | DISABLED`.
- Order: `OPEN | PAYMENT_PENDING | PAID | CANCELLED`.
- Time session: `RUNNING | PAUSED | ENDED`.
- Payment: `PENDING | SUCCEEDED | VOIDED`.

Command tables + SQLite triggers thực thi mở/chuyển/hủy bàn, thêm item và checkout nguyên tử.
