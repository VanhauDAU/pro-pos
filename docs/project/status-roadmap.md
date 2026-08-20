# Trạng thái và roadmap

Cập nhật: 2026-08-20. Baseline mục tiêu: nhánh `dev` sau PRO-009.

## Tiến độ hiện tại

| Giai đoạn        | Phạm vi                                                   | Trạng thái | Bằng chứng chính                      |
| ---------------- | --------------------------------------------------------- | ---------- | ------------------------------------- |
| Foundation       | React/Vite/PWA, Worker, D1/R2 bindings, CI và bootstrap   | COMPLETE   | PRO-001–PRO-003                       |
| Auth UI          | Login responsive, Employee PIN, device activation         | COMPLETE   | PRO-004                               |
| Auth hardening   | Workers crypto, portable PBKDF2, Access OTP               | COMPLETE   | PRO-005–PRO-008                       |
| Access bridge    | Worker riêng, one-time code exchange, staging smoke       | COMPLETE   | PRO-009                               |
| Platform admin   | Store/Owner create, list, lock/unlock                     | COMPLETE   | PRO-007                               |
| Owner operations | Settings, staff, catalog, pricing, areas/tables UI        | READY      | Backend một phần; chờ UI reference    |
| POS sales        | Table board, order/time session, transfer/cancel/add item | PLANNED    | Domain/schema/service baseline có sẵn |
| Checkout/pilot   | Payment, receipt/print, E2E và vận hành pilot             | PLANNED    | Schema/vertical slice baseline có sẵn |

Quality gate PRO-009 tại thời điểm cập nhật: format, lint, main/auth type generation, typecheck,
18 unit tests, 14 Worker integration tests và production build đều đạt.

## Giai đoạn đề xuất tiếp theo

Ưu tiên **Owner Operations Portal** trước POS sales. Owner phải cấu hình cửa hàng, nhân viên, khu
vực, bàn, sản phẩm và bảng giá trước khi một ca bán hàng có dữ liệu thật để vận hành.

Thứ tự thực hiện:

1. Nhận và duyệt UI reference cho Owner shell, dashboard, settings, staff, catalog/pricing và
   areas/tables; cập nhật screen registry.
2. Hoàn thiện route guard Owner, navigation responsive và auth-expired behavior.
3. Tích hợp store settings và staff management.
4. Tích hợp areas, tables, categories, units, products/variants và pricing configuration.
5. Bổ sung update/disable APIs còn thiếu, tenant/RBAC regression và audit coverage.
6. Chạy Owner happy-path E2E trên desktop/mobile, staging smoke và cập nhật runbook.

Chi tiết acceptance criteria và work breakdown nằm trong
[kế hoạch Owner Operations Portal](../product/owner-portal-plan.md).

## Roadmap sau Owner Portal

1. **POS Sales Portal**: sơ đồ bàn, mở/chuyển/hủy bàn, pause/resume, thêm món và quote realtime.
2. **Checkout & Receipt**: cash/bank transfer, invoice, print 58/80 mm và reprint.
3. **Pilot hardening**: E2E full flow, observability, backup/restore drill, rollback drill và UAT.
4. **Production release**: `dev → main`, production migration/deploy, smoke và GitHub Release.

## Quy tắc cập nhật tiến độ

- Mỗi PR cập nhật bảng giai đoạn, changelog và tài liệu contract/schema bị ảnh hưởng.
- UI chỉ chuyển sang `IMPLEMENTED` khi có reference, responsive states, screenshot và xác nhận.
- Một giai đoạn chỉ `COMPLETE` khi `pnpm verify`, migration từ DB sạch, staging smoke và rollback
  note đều đạt.
- Các mục hoãn phải được ghi trong scope; không âm thầm mở rộng MVP.
