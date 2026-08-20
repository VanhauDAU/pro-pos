# Scope MVP

## Trạng thái triển khai

- Foundation, D1 schema, pricing/POS vertical slice: hoàn thành baseline và regression tests.
- Identity/device: hoàn thành Owner/SUPER_ADMIN Access OTP qua auth bridge, Employee PIN và POS
  activation.
- SUPER_ADMIN portal: đã có màn hình quản lý store/Owner tối giản.
- Owner portal và POS portal: backend/contract đã có một phần; UI cuối đang chờ reference.

Theo dõi chi tiết tại [trạng thái và roadmap](../project/status-roadmap.md).

## Luồng pilot

`SUPER_ADMIN tạo store → Owner đăng nhập/kích hoạt POS → cấu hình dữ liệu → Employee PIN → mở
bàn → tính giờ/thêm món → thanh toán → phiếu bán hàng`

## Bao gồm

- Một `store_id` là một cửa hàng; không có chi nhánh.
- SUPER_ADMIN tạo/khóa store và cấp Owner.
- Owner/SUPER_ADMIN login bằng Cloudflare Access email OTP; Owner không yêu cầu device activation.
- Employee PIN chỉ trên POS device `ACTIVE`.
- Nhân viên, permissions, khu vực, bàn, đơn vị, danh mục, sản phẩm và giá giờ.
- Sản phẩm số lượng/trọng lượng có thể bật “Nhập giá khi bán”; giá nhập được validate và snapshot
  tại thời điểm thêm món.
- Mở/chuyển/hủy bàn, pause/resume, thêm món, quote và checkout.
- Cash và bank transfer xác nhận thủ công.
- Phiếu bán hàng nội bộ, browser print 58/80 mm.
- R2 ảnh private, audit log và structured logs.

## Hoãn

- Payment gateway, hóa đơn điện tử, email, CRM, promotion, QR Order.
- API địa chỉ, silent print/Print Agent, offline mutation và báo cáo nâng cao.
- Gộp/tách bill và inventory.
