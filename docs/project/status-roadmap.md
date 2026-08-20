# Kế hoạch tổng thể, trạng thái và checklist phần mềm

Cập nhật: 2026-08-20. Baseline đánh giá: nhánh `dev` sau PRO-009, đối chiếu trực tiếp code,
migrations, OpenAPI, test và runbook trong repository.

Tài liệu này là nguồn theo dõi cấp dự án cho ba câu hỏi:

1. Phần mềm đã làm được gì?
2. Còn thiếu gì để chạy pilot và production ổn định?
3. Nên làm theo thứ tự nào tiếp theo?

Chi tiết quy trình code/release nằm tại
[development-release-workflow.md](development-release-workflow.md); chi tiết giai đoạn Owner tại
[owner-portal-plan.md](../product/owner-portal-plan.md).

## PRO-010A — Security, Tenant & Financial Integrity Hardening

Trạng thái hiện tại: `IN_PROGRESS` — backend hardening và regression coverage đã hoàn tất ở local,
đang chờ staging smoke và preflight dữ liệu trước khi đóng ticket.

Phạm vi đã hoàn tất gồm cross-store revoke, discount
authorization, prompt-price, accounting snapshot, invoice numbering, tenant references, fake-201,
Owner staff protection, one-user-one-store, atomic pause/resume, idempotency retry guideline, audit
context và controlled PWA update. Phạm vi vẫn online-first; không thêm offline mutation.

Quality evidence ngày 2026-08-20:

- `pnpm verify` xanh: format, lint, type generation, typecheck, unit, integration, migration upgrade
  check và production build.
- Unit: `18/18`; Worker integration: `5 files / 26 tests`; migration `0005 → 0006`: pass.
- Staging/production client build: pass; chỉ còn cảnh báo bundle `api` lớn hơn 500 kB.
- Chưa chạy staging smoke cho PRO-010A trong lượt này; chưa đóng `COMPLETE` theo Definition of Done.

## 1. Quy ước trạng thái

| Trạng thái    | Ý nghĩa                                                               |
| ------------- | --------------------------------------------------------------------- |
| `COMPLETE`    | Code, test, tài liệu và staging smoke của phạm vi đã đạt              |
| `PARTIAL`     | Đã có baseline/backend nhưng chưa đủ luồng người dùng hoặc acceptance |
| `IN_PROGRESS` | Đang triển khai/cấu hình hoặc đang chờ nghiệm thu                     |
| `BLOCKED`     | Chưa thể hoàn tất do thiếu input/quyết định bên ngoài                 |
| `PLANNED`     | Đã xác định phạm vi nhưng chưa bắt đầu                                |
| `DEFERRED`    | Chủ động hoãn khỏi MVP/pilot                                          |

Checkbox trong tài liệu:

- `[x]`: đã có bằng chứng trong code/test/docs hoặc đã được smoke.
- `[ ]`: chưa làm, mới làm một phần hoặc cần xác nhận lại trên môi trường thật.

## 2. Tóm tắt điều hành

Pro POS hiện đã hoàn thành nền tảng kỹ thuật, schema nghiệp vụ, auth/device, SUPER_ADMIN portal và
các vertical slice backend chính cho catalog, pricing, POS và checkout. Phần còn thiếu lớn nhất
không nằm ở database mà ở UI vận hành Owner/POS, contract API đầy đủ, E2E và hardening pilot.

Trạng thái giao diện hiện tại:

- Auth, kích hoạt thiết bị và SUPER_ADMIN: đã có UI responsive.
- `/owner/*`: vẫn là placeholder chờ UI reference.
- `/pos/*`: vẫn là placeholder chờ UI reference.
- Checkout/receipt: chưa có UI.

Trạng thái production tại lần kiểm tra 2026-08-20:

- Main Worker production đã phục vụ `/api/health`.
- Auth bridge production đã deploy.
- Cloudflare Access `All traffic` cho auth bridge đã hoàn tất với policy exact-email + One-time PIN.
- Owner/SUPER_ADMIN OTP, Employee PIN, D1/R2 và critical production smoke đã đạt theo xác nhận vận
  hành.
- Production runtime baseline đang hoạt động ổn định. Sản phẩm vẫn chưa đạt `GA` cho đến khi Owner
  Portal, POS, checkout UI, E2E và các drill vận hành hoàn tất.

## 3. Bảng trạng thái theo năng lực

| Năng lực                 | Trạng thái    | Đã có                                                                        | Còn thiếu chính                                                      |
| ------------------------ | ------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Foundation               | `COMPLETE`    | React/Vite/PWA, Hono Worker, D1/R2, TypeScript, CI                           | Theo dõi dependency/compatibility định kỳ                            |
| Database schema          | `COMPLETE`    | 6 migrations cho identity, catalog, POS, billing, Access bridge và hardening | Migration mới theo feature; kiểm tra upgrade path mỗi release        |
| Auth và device           | `COMPLETE`    | Owner/SUPER_ADMIN OTP, Employee PIN, activation/revoke/reissue               | Duy trì policy email và smoke định kỳ                                |
| Access bridge            | `COMPLETE`    | Worker riêng, one-time code, replay protection, D1 chung, Access             | Theo dõi Access logs và đồng bộ exact-email policy                   |
| SUPER_ADMIN              | `COMPLETE`    | Bootstrap, login, dashboard, list/create/lock store + Owner                  | Pagination/search/audit UX nếu dữ liệu tăng                          |
| Owner backend            | `PARTIAL`     | Settings, staff, catalog create/list, tables, pricing upsert, audit          | Update/disable, pricing read, pagination/search, contract hoàn chỉnh |
| Owner portal UI          | `IN_PROGRESS` | Owner shell/dashboard khung, route guard và responsive sidebar accordion     | Module forms, visual approval và data states                         |
| Pricing engine           | `COMPLETE`    | Actual time/block, first period, special window, pause, rounding             | UI editor/preview và E2E với dữ liệu thật                            |
| POS backend              | `PARTIAL`     | Tables, open, quote, items, pause/resume, transfer/cancel, checkout          | Contract đầy đủ, edge cases, UI và E2E                               |
| POS portal UI            | `BLOCKED`     | Route placeholder                                                            | UI reference, table board, order workspace, auth guard               |
| Checkout/invoice backend | `PARTIAL`     | Idempotent checkout, invoice list/detail baseline                            | Payment UX, receipt/reprint, reconciliation test                     |
| Checkout/receipt UI      | `PLANNED`     | Scope 58/80 mm đã xác định                                                   | Reference, implementation, browser print validation                  |
| Media/R2                 | `PARTIAL`     | Private upload/read/delete service và binding                                | Owner UI, validation/limits, orphan cleanup, production smoke        |
| OpenAPI                  | `PARTIAL`     | Auth và một số platform/owner/POS paths                                      | Đồng bộ toàn bộ routes, schemas, errors và examples                  |
| Unit tests               | `COMPLETE`    | 18 tests Pricing Engine/state machine                                        | Mở rộng theo domain mới                                              |
| Worker integration tests | `COMPLETE`    | 5 files, 26 tests auth/device/database/POS/security vertical slice           | Bổ sung Owner CRUD, media, failure/recovery coverage                 |
| Browser E2E              | `PLANNED`     | Có script/dependency Playwright                                              | Chưa có test suite/config/happy path                                 |
| Observability            | `PARTIAL`     | Structured logs, request ID, Worker observability                            | Alert, dashboard, retention, runbook truy vấn                        |
| Backup/rollback/incident | `PARTIAL`     | Có runbook                                                                   | Chưa ghi nhận restore/rollback/incident drill                        |
| Production readiness     | `PARTIAL`     | Worker/D1/R2/secrets, Access OTP và production smoke đã hoạt động            | Backup record, rollback target, tag/release, monitoring và GA gates  |

Quality evidence tại lần cập nhật:

- Unit: 2 files, 18 tests pass.
- Worker integration: 5 files, 26 tests pass; migration upgrade script cũng pass.
- CI có format, lint, type generation cho main/auth, typecheck, unit, integration và build.
- Chưa có browser E2E được triển khai.

## 4. Những gì đã hoàn thành

### 4.1 Nền tảng và kiến trúc

- [x] React 19 + Vite + TypeScript strict.
- [x] SPA/PWA assets do main Worker phục vụ.
- [x] Hono API cùng origin với client.
- [x] Main Worker và auth bridge Worker tách riêng trust boundary.
- [x] D1 binding cho dữ liệu tenant/nghiệp vụ.
- [x] R2 private binding cho media.
- [x] Cấu hình tách `local`, `staging`, `production`.
- [x] Git flow `feature → dev → main` và CI quality gate.
- [x] Runbook deploy, rollback, incident, backup/restore và secret rotation.

### 4.2 Identity, auth, device và security baseline

- [x] SUPER_ADMIN/Owner đăng nhập bằng Cloudflare Access email OTP.
- [x] Auth bridge tạo authorization code one-time, chỉ lưu hash và chống replay.
- [x] Email Access vẫn phải map vào identity/role/store trong D1.
- [x] Employee đăng nhập username/PIN chỉ trên POS device `ACTIVE`.
- [x] Owner login không phụ thuộc POS activation.
- [x] Device activation grant tách khỏi Owner session.
- [x] Device revoke và credential reissue.
- [x] HttpOnly/Secure/SameSite cookie policy cho production.
- [x] Same-origin/CSRF baseline cho mutation nhạy cảm.
- [x] Tenant/RBAC lấy từ session/device server-side, không tin `store_id` client gửi lên.

### 4.3 Platform administration

- [x] Bootstrap SUPER_ADMIN một lần bằng secret.
- [x] SUPER_ADMIN login UI.
- [x] Dashboard/list stores.
- [x] Tạo store và Owner email.
- [x] Lock/unlock store.
- [x] Responsive baseline và error/loading states chính.

### 4.4 Owner/backend baseline

- [x] Đọc/cập nhật store settings.
- [x] Đọc audit logs gần nhất.
- [x] List/create Employee.
- [x] Enable/disable Employee.
- [x] Reset PIN.
- [x] List/create area, category và unit.
- [x] List/create product/variant baseline.
- [x] List/create table.
- [x] Upsert pricing configuration.
- [x] Upload/read/delete private media baseline.

### 4.5 POS, pricing và checkout backend baseline

- [x] Table/order/time/payment state machines.
- [x] Server-authoritative Pricing Engine.
- [x] List table board data.
- [x] Mở bàn/order idempotently.
- [x] Thêm product item với snapshot.
- [x] Pause/resume time session.
- [x] Quote realtime từ dữ liệu server.
- [x] Transfer và cancel order/table baseline.
- [x] Checkout idempotently.
- [x] Invoice list/detail baseline.
- [x] SQLite triggers/command tables bảo vệ invariant quan trọng.

## 5. Những gì chưa hoàn thành hoặc mới có một phần

### 5.1 Production đã xác nhận và hồ sơ vận hành còn lại

- [x] Hoàn tất Cloudflare Access `All traffic` cho `pro-pos-auth-production`.
- [x] Gắn reusable policy `Allow` theo exact email và `Require One-time PIN`.
- [x] Xác nhận request chưa đăng nhập được redirect tới Cloudflare Access, không trả JSON `401` từ
      Worker.
- [x] Smoke SUPER_ADMIN và Owner OTP trên cửa sổ browser sạch.
- [x] Smoke Employee PIN/device, D1 mutation và R2 trên production.
- [ ] Ghi production deployment/version ID, migration state và backup bookmark.

### 5.2 Product/UI

- [x] Nhận UI reference Owner shell/dashboard desktop/mobile; module references tiếp tục theo PRO-011–014.
- [ ] Nhận/duyệt UI reference POS table board/order desktop/mobile/tablet.
- [ ] Nhận/duyệt UI reference checkout/receipt 58/80 mm.
- [x] Thay `/owner/*` placeholder bằng Owner shell/dashboard khung; module forms tiếp tục theo PRO-011–014.
- [ ] Thay `/pos/*` placeholder bằng portal thật.
- [ ] Xây receipt preview/print/reprint.
- [ ] Hoàn thiện empty/loading/error/403/session-expired/conflict/offline states.

### 5.3 API/backend

- [ ] Update/disable areas, categories, units, products/variants và tables.
- [ ] GET pricing config để edit an toàn; xác định optimistic concurrency/versioning.
- [ ] Chuẩn hóa permission catalog dùng khi tạo/sửa Employee.
- [ ] Pagination/search/filter cho list store/staff/catalog/invoice/audit.
- [ ] Audit đầy đủ cho mọi mutation Owner/POS/platform quan trọng.
- [ ] Chuẩn hóa error contract và map field errors cho UI.
- [ ] Đồng bộ OpenAPI với toàn bộ routes thực tế.
- [ ] Hoàn thiện media constraints: MIME, size, dimensions, orphan cleanup và soft-delete policy.
- [ ] Bổ sung rate limiting/abuse protection cho auth/PIN và mutation rủi ro.

### 5.4 Quality và vận hành

- [ ] Playwright E2E: platform → store/owner → activation → employee → order → checkout → invoice.
- [ ] Browser matrix tối thiểu: Chrome desktop, mobile viewport và Safari/iPhone smoke.
- [ ] Accessibility: keyboard, labels, focus, contrast và automated smoke.
- [ ] Performance budget: startup, bundle, API latency và Core Web Vitals.
- [ ] Security headers/CSP review và dependency vulnerability review.
- [ ] Observability dashboard, alert thresholds và log retention.
- [ ] Backup/export automation hoặc lịch vận hành được phê duyệt.
- [ ] Thực hành rollback Worker, D1 restore và incident drill.
- [ ] Pilot seed/test-data strategy không chứa dữ liệu thật trong git.
- [ ] UAT với người dùng thực tế và sign-off.

## 6. Thứ tự giai đoạn đề xuất

```text
P0 Production baseline
        ↓
P1 Owner Operations Portal
        ↓
P2 POS Sales Portal
        ↓
P3 Checkout & Receipt
        ↓
P4 Pilot hardening + UAT
        ↓
P5 Production release/GA
        ↓
P6 Post-MVP
```

Không nên làm POS UI trước Owner Portal vì POS cần store settings, staff, area/table, catalog và
pricing đã được Owner cấu hình.

## 7. Kế hoạch chi tiết theo giai đoạn

### P0 — Ổn định production baseline

Mục tiêu: biến deployment hiện tại thành một baseline có thể đăng nhập, kiểm tra và rollback.

- [x] Main Worker production đã deploy.
- [x] Auth bridge production đã deploy.
- [x] D1/R2 production resources đã được khai báo.
- [x] Hoàn tất Access policy production exact-email + OTP.
- [x] Xác nhận migrations production đã áp dụng đủ và không còn pending ngoài dự kiến.
- [x] Xác nhận bốn secrets đúng environment và không dùng chung staging.
- [x] Chạy smoke health/version, OTP, Employee PIN, D1/R2.
- [ ] Lưu D1 bookmark/export baseline.
- [ ] Ghi rollback target cho cả main Worker và auth bridge.
- [ ] Tạo tag/GitHub Release baseline sau smoke.

Exit criteria:

- Unauthorized request bị Access chặn trước auth bridge.
- Authorized email trong Access + D1 tạo đúng session.
- Email chỉ có trong Access nhưng không có D1 bị từ chối.
- Employee PIN/device flow và critical data mutation hoạt động.
- Có deployment record và rollback target.

### P1 — Owner Operations Portal

Mục tiêu: Owner tự cấu hình đủ dữ liệu để cửa hàng bắt đầu bán hàng.

Work breakdown đã thống nhất:

1. **PRO-010 — Owner shell và route guard**.
2. **PRO-011 — Store settings và staff**.
3. **PRO-012 — Catalog foundations**.
4. **PRO-013 — Tables và time pricing**.
5. **PRO-014 — Owner E2E và staging hardening**.

Checklist:

- [x] UI reference Owner shell/dashboard đã nhận và chuyển thành khung MVP; settings/staff/catalog/tables/pricing/audit tiếp tục theo ticket sau.
- [x] Route guard, deep link, logout và session-expired behavior cho Owner shell.
- [x] Dashboard readiness checklist khung.
- [x] Settings landing hub theo nhóm thông tin, chức năng và nhật ký; form chi tiết tiếp tục theo ticket sau.
- [ ] Store settings form.
- [ ] Employee lifecycle, permission và PIN reset UI.
- [ ] Area/table CRUD và time product assignment.
- [ ] Category/unit/product/variant CRUD và media UI.
- [ ] Pricing read/edit/validation preview.
- [ ] Audit log UI.
- [ ] Hoàn thiện API update/disable/read còn thiếu.
- [ ] Cross-store/RBAC/audit integration tests.
- [ ] Desktop/mobile screenshots và visual approval.
- [ ] Owner happy-path E2E và staging smoke.

Exit criteria: Owner có thể tạo cấu hình tối thiểu, tạo Employee, kích hoạt POS và bàn giao cho ca
bán hàng mà không cần thao tác trực tiếp database.

### P2 — POS Sales Portal

Mục tiêu: Employee vận hành bàn và order trong ca bán hàng.

Checklist:

- [ ] UI reference table board/order workspace/tablet/mobile.
- [ ] POS route guard yêu cầu Employee session + device `ACTIVE`.
- [ ] Table board theo area và trạng thái realtime/refresh.
- [ ] Open table/order với idempotency key.
- [ ] Running/paused timer và quote preview.
- [ ] Product search/category/variant và add item.
- [ ] Update/remove item nếu được chốt trong scope.
- [ ] Pause/resume, transfer và cancel với confirmation.
- [ ] Conflict/stale-version/retry-safe UX.
- [ ] Permission visibility và server-side enforcement.
- [ ] Lost-response/replay/cross-store integration coverage.
- [ ] POS happy-path E2E và staging smoke.

Exit criteria: Employee có thể đăng nhập, mở bàn, tính giờ, thêm món, chuyển/hủy đúng quyền và đưa
order tới checkout.

### P3 — Checkout, invoice và receipt

Mục tiêu: hoàn tất giao dịch và tạo chứng từ nội bộ có thể in lại.

- [ ] Checkout summary tách tiền giờ/món/giảm trừ nếu có.
- [ ] Cash và bank transfer xác nhận thủ công.
- [ ] Idempotent checkout UI và double-submit protection.
- [ ] Invoice detail/history.
- [ ] Receipt layout 58 mm và 80 mm.
- [ ] Browser print preview và reprint.
- [ ] Permission cho checkout/invoice.
- [ ] Reconciliation checks cho payment/invoice/order/table.
- [ ] Double checkout, lost response và retry E2E.
- [ ] Staging print test trên thiết bị pilot.

Exit criteria: một order có thể checkout đúng một lần, tạo invoice nhất quán, tra cứu và in lại.

### P4 — Pilot hardening và UAT

Mục tiêu: chứng minh hệ thống chịu được một luồng cửa hàng thật có kiểm soát.

- [ ] Full Playwright E2E trên dữ liệu pilot giả lập.
- [ ] Cross-browser/responsive/accessibility pass.
- [ ] Startup/bundle/API performance budget đạt.
- [ ] Structured logging dashboard và alerts.
- [ ] Backup/restore drill có biên bản.
- [ ] Worker rollback drill có biên bản.
- [ ] Incident tabletop cho auth, D1, checkout và R2.
- [ ] Secret rotation rehearsal không làm mất khả năng truy cập.
- [ ] UAT script và Owner/Employee sign-off.
- [ ] Support/escalation owner và thời gian phản hồi.
- [ ] Known issues/deferred scope được ghi rõ.

Exit criteria: UAT đạt, không còn lỗi Sev-1/Sev-2 mở, restore/rollback đã thực hành và người vận hành
đồng ý chạy pilot.

### P5 — Production release/GA

Mục tiêu: phát hành phiên bản pilot/GA có kiểm soát và theo dõi sau deploy.

- [ ] Code freeze và release PR `dev → main`.
- [ ] CI `quality` xanh trên release commit.
- [ ] Staging smoke đúng commit sẽ phát hành.
- [ ] Production D1 bookmark/export trước migration.
- [ ] Apply migration production và xác nhận kết quả.
- [ ] Deploy auth bridge/main Worker đúng thứ tự tương thích.
- [ ] Production smoke đầy đủ.
- [ ] Tag/GitHub Release và deployment record.
- [ ] Theo dõi logs/metrics sau release.
- [ ] Kế hoạch rollback/forward-fix và người quyết định rõ ràng.

Chi tiết thao tác xem
[quy trình phát triển và phát hành](development-release-workflow.md).

### P6 — Post-MVP/deferred

Chỉ đưa vào kế hoạch sau khi pilot ổn định và có nhu cầu đã xác nhận:

- [ ] Payment gateway.
- [ ] Hóa đơn điện tử.
- [ ] Inventory.
- [ ] Promotion/loyalty/CRM.
- [ ] QR Order.
- [ ] Gộp/tách bill.
- [ ] Offline mutation/sync.
- [ ] Silent print/Print Agent.
- [ ] Báo cáo nâng cao.
- [ ] API địa chỉ.
- [ ] Email/notification automation.
- [ ] Multi-branch nếu thay đổi mô hình một store = một cửa hàng.

## 8. Checklist đầy đủ theo chuyên môn

### Product và UX

- [x] MVP scope và deferred scope đã ghi.
- [x] Pilot happy path đã xác định.
- [ ] Acceptance criteria từng Owner/POS/checkout screen.
- [ ] UI references và visual approval.
- [ ] Empty/loading/error/permission/session/conflict states.
- [ ] UAT script, pilot user và sign-off owner.
- [ ] Privacy/data retention/support policy.

### Frontend

- [x] Auth/activation/platform routes.
- [x] Responsive auth và SUPER_ADMIN baseline.
- [ ] Owner shell và feature screens.
- [ ] POS shell và feature screens.
- [ ] Checkout/receipt screens.
- [ ] Query caching/invalidation và optimistic/retry policy.
- [ ] Error boundary/session expiration behavior toàn app.
- [ ] Accessibility và keyboard navigation.
- [ ] Browser/PWA install/update/offline-read behavior.
- [ ] Bundle/performance budgets.

### API và domain

- [x] Server-authoritative trust boundary.
- [x] Zod validation baseline.
- [x] Auth/device/platform/owner/POS vertical slices.
- [x] Pricing/state machine pure domain logic.
- [x] Idempotent critical POS commands baseline.
- [ ] CRUD/update/disable còn thiếu.
- [ ] Pagination/search/filter.
- [ ] API version/conflict conventions.
- [ ] OpenAPI coverage toàn bộ routes và error schemas.
- [ ] Rate limiting và abuse controls.
- [ ] Background cleanup/retention jobs nếu cần.

### Database và dữ liệu

- [x] Tenant/RBAC/auth/device schema.
- [x] Catalog/pricing/POS/payment/invoice/audit schema.
- [x] Forward-only migrations.
- [x] Trigger/invariant integration tests baseline.
- [ ] Upgrade-from-previous-version test trong release gate.
- [ ] Index/query plan review với dữ liệu gần pilot.
- [ ] Seed/fixture strategy không dùng dữ liệu thật.
- [ ] Retention/cleanup cho session, grant, auth request và media orphan.
- [ ] Backup/export schedule và restore drill.
- [ ] Data reconciliation queries cho order/payment/invoice/table.

### Security

- [x] HttpOnly secure cookies và credential không nằm trong localStorage.
- [x] Server derives store/actor/permission.
- [x] Access identity còn được kiểm tra trong D1.
- [x] Replay-resistant auth exchange và idempotency baseline.
- [x] Secrets không commit vào git.
- [x] Production Access exact-email + OTP được smoke.
- [ ] Rate limit Employee PIN/Access start/bootstrap endpoints.
- [ ] Security headers/CSP review.
- [ ] File upload hardening.
- [ ] Dependency/security scanning trong CI.
- [ ] Secret rotation drill và credential version migration plan.
- [ ] Security review cho cross-store, privilege escalation và log leakage.

### Test và quality

- [x] Format/lint/type generation/typecheck/build gate.
- [x] Unit tests cho pricing/state machine.
- [x] Worker integration auth/device/database/POS baseline.
- [ ] Owner CRUD/media integration coverage.
- [ ] Negative RBAC/cross-store coverage cho mọi mutation.
- [ ] Playwright happy path.
- [ ] Failure/replay/lost-response E2E.
- [ ] Accessibility automation.
- [ ] Performance/load/startup checks.
- [ ] Release smoke automation phù hợp.

### Operations và release

- [x] Environment-specific Worker/D1/R2 config.
- [x] Deploy/migration/bootstrap scripts.
- [x] GitHub CI và branch flow tài liệu hóa.
- [x] Deploy/rollback/incident/backup/secret runbooks.
- [ ] Workers Builds staging/production được xác nhận và ghi owner.
- [ ] Monitoring/alerting/log retention.
- [ ] Backup/restore/rollback drills.
- [ ] Release tag/version/commit traceability.
- [ ] Custom domain/TLS decision nếu không dùng `workers.dev` lâu dài.
- [ ] On-call/support/escalation và status communication.

### Documentation

- [x] Scope, architecture, ADR, migrations, auth invariants.
- [x] Git/release workflow và operational runbooks.
- [x] Owner portal plan.
- [ ] OpenAPI hoàn chỉnh theo code.
- [ ] Screen registry cập nhật theo từng reference/PR.
- [ ] User guide cho SUPER_ADMIN, Owner và Employee.
- [ ] Pilot setup/training guide.
- [ ] Known issues và release notes mỗi phiên bản.

## 9. Ưu tiên hành động tiếp theo

Thứ tự khuyến nghị tại thời điểm cập nhật:

1. Ghi production deployment/version ID, migration state, backup bookmark và rollback target.
2. Chốt tiếp UI reference cho các module Owner; shell/dashboard reference đã có và là nền của PRO-010.
3. Triển khai Owner shell/route guard trước, sau đó settings/staff.
4. Hoàn thiện catalog/tables/pricing API + UI và Owner E2E.
5. Chốt UI reference POS rồi triển khai table board/order workspace.
6. Hoàn thiện checkout/receipt/print.
7. Bổ sung Playwright full flow, accessibility, performance và security hardening.
8. Hoàn thiện monitoring/log retention và release traceability.
9. Thực hành backup/restore/rollback/incident và chạy UAT pilot.
10. Chỉ phát hành GA khi checklist P4 và P5 đạt.

## 10. Rủi ro và dependency

| Rủi ro/dependency                     | Ảnh hưởng                                    | Hành động kiểm soát                                      |
| ------------------------------------- | -------------------------------------------- | -------------------------------------------------------- |
| Thiếu UI reference Owner/POS/receipt  | UI bị block hoặc lệch kỳ vọng                | Duyệt reference trước code; cập nhật screen registry     |
| Access policy lệch email/D1 identity  | OTP không gửi hoặc đăng nhập bị từ chối      | Exact-email policy, smoke authorized/unauthorized        |
| Deploy code trước migration           | Runtime lỗi schema                           | Additive migration, apply theo release checklist         |
| Hai Worker không tương thích          | Auth callback thất bại                       | Backward compatibility, deploy/smoke cả bridge và main   |
| Chưa có browser E2E                   | Regression chỉ lộ trên UI thật               | Hoàn thiện Playwright trước pilot                        |
| Retry/double-submit khi mất mạng      | Trùng checkout/order mutation                | Idempotency end-to-end và lost-response tests            |
| Restore D1 ghi đè giao dịch mới       | Mất dữ liệu sau restore point                | Phê duyệt RPO, khóa mutation, reconciliation sau restore |
| Secret rotation không có version plan | Session/device/PIN mất hiệu lực ngoài ý muốn | Rehearsal, credential version và staged rotation         |
| Scope creep ngoài MVP                 | Chậm pilot                                   | Giữ deferred list; thay đổi scope phải được duyệt        |

## 11. Definition of Done chung

Một ticket chỉ được coi là hoàn thành khi:

- Acceptance criteria đạt và không mở rộng scope âm thầm.
- `pnpm verify` xanh.
- Có regression test phù hợp.
- Migration chạy từ DB sạch và upgrade path được kiểm tra nếu có schema change.
- OpenAPI/docs/ADR/runbook được cập nhật trong cùng PR.
- Tenant/auth/device/RBAC và audit impact đã được xem xét.
- UI có reference, responsive states, screenshot và approval nếu liên quan.
- Staging smoke đạt; có rollback/forward-fix note.
- Không log hoặc commit password, PIN, cookie, token hay secret.

Một giai đoạn chỉ chuyển sang `COMPLETE` khi mọi exit criteria của giai đoạn đạt, không chỉ vì code
backend đã merge.

## 12. Quy tắc duy trì tài liệu

- Mỗi PR cập nhật trạng thái/checklist liên quan trong file này.
- Chỉ đánh `[x]` khi có bằng chứng; nếu chỉ có backend thì giữ `PARTIAL` cho năng lực end-to-end.
- Mọi UI PR cập nhật [UI screen registry](../ui-screen-registry.md).
- Mọi route/error contract mới cập nhật [OpenAPI](../api/openapi.yaml).
- Mọi migration mới cập nhật [migration policy](../database/migrations.md).
- Mọi thay đổi vận hành cập nhật runbook tương ứng.
- Khi scope MVP thay đổi, cập nhật [scope.md](../product/scope.md) trước khi tạo ticket.
- Sau mỗi production release, ghi commit/tag, migration, deployment ID, smoke result và known issues.
