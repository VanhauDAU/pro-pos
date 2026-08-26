# Incident runbook

1. Ghi environment, app version, request ID, store và thời điểm UTC.
2. Nếu liên quan checkout/pricing, tạm khóa mutation nhạy cảm thay vì sửa dữ liệu trực tiếp.
3. Dùng Workers Logs và audit logs; không yêu cầu người dùng gửi PIN/token.
4. Phân loại code, binding, migration, D1 data, R2 hoặc quota/CPU.
5. Rollback/forward-fix theo runbook; ghi post-incident và regression test.

## Sai lệch tổng tiền hoặc phiên bản đơn POS

1. Ghi `requestId`, order ID, store, thời điểm, số tiền ở Khu vực và số tiền trong đơn; không chụp
   cookie, PIN hoặc token.
2. Tìm log `pos quote changed during read`, `api application error` và mã
   `ORDER_VERSION_CONFLICT`/`PAYMENT_SNAPSHOT_INVALID` theo request ID.
3. Xác nhận `/api/v1/pos/overview` và `/api/v1/pos/orders/:id/quote` trả cùng `order.version` và
   `totalVnd`. Không sửa trực tiếp D1 và không thay tổng tiền trên client.
4. Nếu overview/quote không dựng được, giữ snapshot UI gần nhất kèm cảnh báo và khóa mutation của
   màn đơn/thanh toán cho đến khi quote mới tải thành công.
5. Nếu lỗi lặp lại, tạm dừng checkout của store liên quan, lưu deployment/version ID và ưu tiên
   forward-fix; Worker rollback chỉ được dùng khi schema vẫn tương thích.
