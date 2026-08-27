# Backup và restore

- D1 Time Travel là lớp phục hồi ngắn hạn; Free hiện giữ 7 ngày.
- Trước migration production: lưu bookmark hiện tại và export database.
- Backup không commit vào repository public; lưu ở nơi riêng có kiểm soát truy cập.
- Restore chỉ do người có thẩm quyền duyệt sau khi xác định RPO và giao dịch sẽ mất.
- Sau restore: kiểm tra foreign keys, payment/invoice uniqueness, open order/table consistency.

## Retention vận hành 7 ngày

- Cron hằng ngày và nút SUPER_ADMIN dùng chung `MaintenanceService.runRetentionCleanup(7)`.
- Dữ liệu được dọn gồm logs/realtime đã giao, session hết hạn, command/idempotency history,
  notification, payment snapshot đã kết thúc, import/save context, table-open request đã xử lý,
  QR order đã xác nhận/từ chối/hủy/hết hạn và service request đã hoàn tất/hủy.
- Lịch sử call-batch quá hạn chỉ được xóa sau khi order tương ứng đã `PAID` hoặc `CANCELLED`.
- Không xóa order, order item, invoice, invoice line, payment, công nợ, loyalty hoặc dữ liệu cấu hình.
- CLI tương đương: `pnpm db:cleanup:<local|staging|production> -- 7`.
