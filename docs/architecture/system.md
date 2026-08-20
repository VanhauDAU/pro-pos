# Kiến trúc hệ thống

```text
Windows/iPhone/Android Browser
        │ same-origin HTTPS + HttpOnly cookies
        ▼
Cloudflare Worker + Static Assets
        │
        ├── D1: tenant/auth/catalog/POS/payment/invoice/audit
        └── R2: private media objects
```

## Code boundary

`route → middleware → service → repository → D1/R2 binding`

- `src/contracts`: Zod/DTO/enums.
- `src/domain`: pure state/pricing logic.
- `src/server`: trust boundary và adapters.
- `src/client`: untrusted intent/UI.

Mọi query nghiệp vụ nhận store context từ session/device đã xác thực. Worker không dùng Cloudflare
REST API cho D1/R2; chỉ dùng bindings. Không có request-scoped mutable global state.

## Trạng thái chính

- Table: `AVAILABLE | OCCUPIED | DISABLED`.
- Order: `OPEN | PAYMENT_PENDING | PAID | CANCELLED`.
- Time session: `RUNNING | PAUSED | ENDED`.
- Payment: `PENDING | SUCCEEDED | VOIDED`.

Command tables + SQLite triggers thực thi mở/chuyển/hủy bàn, thêm item và checkout nguyên tử.
