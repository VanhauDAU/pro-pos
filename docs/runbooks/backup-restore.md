# Backup và restore

- D1 Time Travel là lớp phục hồi ngắn hạn; Free hiện giữ 7 ngày.
- Trước migration production: lưu bookmark hiện tại và export database.
- Backup không commit vào repository public; lưu ở nơi riêng có kiểm soát truy cập.
- Restore chỉ do người có thẩm quyền duyệt sau khi xác định RPO và giao dịch sẽ mất.
- Sau restore: kiểm tra foreign keys, payment/invoice uniqueness, open order/table consistency.

## Retention vận hành

- Cron hằng ngày và nút SUPER_ADMIN dùng chung `MaintenanceService.runRetentionCleanup()`.
- Dữ liệu được dọn theo policy riêng gồm operational audit/realtime đã giao (7 ngày), notification
  (expires/3 ngày), terminal print job và payment snapshot đã kết thúc (14 ngày), session hết hạn,
  command/idempotency history (7 ngày), import/save context, table-open request đã xử lý, QR order
  đã xác nhận/từ chối/hủy/hết hạn và service request đã hoàn tất/hủy.
- Lịch sử call-batch quá hạn chỉ được xóa sau khi order tương ứng đã `PAID` hoặc `CANCELLED`.
- Không xóa order, order item, invoice, invoice line, payment, công nợ, loyalty hoặc dữ liệu cấu hình.
- Cleanup thủ công chạy từ màn hình SUPER_ADMIN. Không duy trì SQL cleanup riêng ở CLI.
