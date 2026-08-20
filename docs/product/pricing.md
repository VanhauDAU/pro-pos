# Đặc tả Pricing Engine

- Backend lưu `started_at`, `ended_at` và pause intervals; frontend timer chỉ để hiển thị.
- Thứ tự áp dụng: first period → special window → base price.
- `ACTUAL_TIME`: cộng phân số tiền bằng integer/BigInt và chỉ làm tròn VND sau khi cộng.
- `TIME_BLOCK`: mỗi pricing segment bắt đầu được tính đủ một block.
- Special windows có độ chính xác phút, hỗ trợ qua ngày; không cho overlap khi chưa có priority.
- Rounding chỉ thực hiện một lần sau toàn bộ tiền giờ.
- Snapshot bảng giá khi mở phiên; sửa giá không tác động phiên đang chạy/invoice cũ.
- Tiền là integer VND, thời gian là integer seconds.

Test chuẩn gồm 1/59/60/61 phút, first period, special boundary, qua ngày, pause/resume,
ACTUAL_TIME/TIME_BLOCK và rounding.
