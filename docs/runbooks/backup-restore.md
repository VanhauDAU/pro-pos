# Backup và restore

- D1 Time Travel là lớp phục hồi ngắn hạn; Free hiện giữ 7 ngày.
- Trước migration production: lưu bookmark hiện tại và export database.
- Backup không commit vào repository public; lưu ở nơi riêng có kiểm soát truy cập.
- Restore chỉ do người có thẩm quyền duyệt sau khi xác định RPO và giao dịch sẽ mất.
- Sau restore: kiểm tra foreign keys, payment/invoice uniqueness, open order/table consistency.
