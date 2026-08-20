# Pro POS

Pro POS là Web App/PWA quản lý cửa hàng billiards, triển khai React SPA và API trên Cloudflare
Workers. Main Worker phục vụ SPA/API; auth bridge Worker riêng hoàn tất Cloudflare Access email
OTP. Dữ liệu nghiệp vụ lưu tại D1; ảnh lưu trong R2.

## Trạng thái

- Foundation React/Vite/Worker/PWA: đã khởi tạo.
- D1 schema: tenant, auth/device, catalog/pricing, POS, checkout, invoice và audit.
- Auth invariant: Owner vào `/owner` không cần kích hoạt POS; Employee PIN bắt buộc device
  `ACTIVE`.
- Pricing Engine: ACTUAL_TIME, TIME_BLOCK, first period, special windows, pause và rounding.
- UI auth: responsive login/activation flow theo mẫu đã duyệt; Owner/SUPER_ADMIN dùng Cloudflare
  Access email OTP, Employee dùng PIN và chỉ đăng nhập trên device `ACTIVE`.
- Auth bridge: Access-protected Worker riêng, authorization code one-time và callback theo đúng
  mục đích Owner/platform/device; main Worker không bị Access chặn.
- SUPER_ADMIN UI tối giản: thống kê, danh sách, tạo store + Owner email và khóa/mở store.
- Giai đoạn kế tiếp được đề xuất: Owner Operations Portal. Xem
  [trạng thái và roadmap](docs/project/status-roadmap.md).

## Yêu cầu

- Node.js 24 LTS.
- pnpm 11.
- Tài khoản Cloudflare và Wrangler 4.x khi cần deploy.

## Chạy local

```bash
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
pnpm cf-typegen
pnpm cf-typegen:auth
pnpm db:migrate:local
pnpm dev
```

Chạy auth bridge ở terminal thứ hai:

```bash
pnpm dev:auth
```

Kiểm tra API:

```bash
curl http://localhost:5173/api/health
curl http://localhost:5173/api/version
```

## Quality gate

```bash
pnpm verify
```

Các gate thành phần:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm cf-typegen:check
pnpm cf-typegen:auth:check
pnpm test
pnpm test:integration
pnpm build
```

## Nhánh Git

- `main`: production.
- `dev`: staging.
- `feat/PRO-<id>-<slug>`: nhánh ngắn hạn, PR vào `dev`.

Xem [CONTRIBUTING.md](CONTRIBUTING.md) và [docs/README.md](docs/README.md).

## Bảo mật

- Không commit `.dev.vars`, `.env`, database export hoặc dữ liệu cửa hàng thật.
- Không lưu session/device credential trong localStorage.
- Production cookies: `__Host-propos-device`, `__Host-propos-session`,
  `__Host-propos-activation`, `__Host-propos-access` với
  `HttpOnly; Secure; SameSite=Lax; Path=/; no Domain`.
- Owner password không được Pro POS lưu hoặc xử lý; Access OTP chỉ hoàn tất khi email đã được ánh xạ
  trong D1. Xem
  [auth-device-invariants.md](docs/security/auth-device-invariants.md).
