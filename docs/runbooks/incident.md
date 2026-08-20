# Incident runbook

1. Ghi environment, app version, request ID, store và thời điểm UTC.
2. Nếu liên quan checkout/pricing, tạm khóa mutation nhạy cảm thay vì sửa dữ liệu trực tiếp.
3. Dùng Workers Logs và audit logs; không yêu cầu người dùng gửi PIN/token.
4. Phân loại code, binding, migration, D1 data, R2 hoặc quota/CPU.
5. Rollback/forward-fix theo runbook; ghi post-incident và regression test.
