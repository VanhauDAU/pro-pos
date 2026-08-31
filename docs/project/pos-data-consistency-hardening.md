# POS data consistency hardening

Cập nhật: 2026-09-01.

## Invariants

- Quote và overview là server-authoritative; realtime chỉ báo dữ liệu đã đổi.
- `version`, trạng thái, bàn và tổng tiền của một overview order phải đến từ cùng một stable quote.
- Order Editor và Payment không mở khóa mutation trước khi có quote authoritative của ý định điều
  hướng hiện tại: quote được prefetch từ thao tác chạm trong tối đa 2 giây hoặc GET của lần mount
  hiện tại. Quote đã bị realtime/invalidation đánh dấu stale luôn phải tải lại.
- Bàn RUNNING dùng safety refresh 120 giây khi realtime CONNECTED; timer hiển thị chạy client-side.
  Khi realtime không CONNECTED, quote/overview fallback polling 5/20 giây.
- Quote không dựng được phải làm request thất bại; không thay bằng `totalVnd: 0`.

## Coverage và quality gate

- Unit: quote mới prefetch từ thao tác chạm không gọi GET trùng; inactive quote cache v12 →
  invalidate → mount/refetch v14; polling policy; validation và request ID; retry stable versioned
  read.
- Integration: overview total/version khớp quote; quote failure không bị đổi thành tổng 0;
  checkout/version conflict vẫn do server chặn.
- Authenticated E2E staging: inactive quote refresh, payment lifecycle, table/active-order cache,
  connected idle network budget và 120-second RUNNING safety refresh.
- Gate bắt buộc: `pnpm verify`, `pnpm test:migrations`, authenticated E2E staging và POS benchmark
  với 1/5/10/20 active orders. Benchmark đo cả `/overview` và `/orders/:id/quote`; p95 không tăng quá
  20% so với artifact baseline của cùng staging store.

## Phạm vi tiếp theo

Audit sau POS theo thứ tự auth/device/RBAC, catalog/import, customer/debt, invoice/printing,
Owner/PWA và operations. Sev-1 (sai tiền, mất dữ liệu, thanh toán trùng, tenant/security) chặn
release; Sev-2 (luồng chính hoặc tự phục hồi/realtime hỏng) chặn pilot; Sev-3 vào backlog có metric.
