# Rollback runbook

- Code/assets không đổi schema: dùng Wrangler rollback về version trước.
- Schema additive: rollback code chỉ khi version trước vẫn tương thích.
- Schema breaking: ưu tiên forward-fix; không rollback mù.
- Dữ liệu tài chính sai: khóa mutation nhạy cảm, điều tra bằng request/audit ID.
- Không restore D1 khi chưa có phê duyệt vì restore ghi đè dữ liệu mới.
- R2 dùng immutable object key và soft-delete để version cũ vẫn đọc được.
