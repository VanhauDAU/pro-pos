# Scope giai đoạn đầu

## Luồng pilot

`SUPER_ADMIN tạo store → Owner đăng nhập/kích hoạt POS → cấu hình dữ liệu → Employee PIN → mở
bàn → tính giờ/thêm món → thanh toán → phiếu bán hàng`

## Bao gồm

- Một `store_id` là một cửa hàng; không có chi nhánh.
- SUPER_ADMIN tạo/khóa store và cấp Owner.
- Owner login không yêu cầu device activation.
- Employee PIN chỉ trên POS device `ACTIVE`.
- Nhân viên, permissions, khu vực, bàn, đơn vị, danh mục, sản phẩm và giá giờ.
- Mở/chuyển/hủy bàn, pause/resume, thêm món, quote và checkout.
- Cash và bank transfer xác nhận thủ công.
- Phiếu bán hàng nội bộ, browser print 58/80 mm.
- R2 ảnh private, audit log và structured logs.

## Hoãn

- Payment gateway, hóa đơn điện tử, email, CRM, promotion, QR Order.
- API địa chỉ, silent print/Print Agent, offline mutation và báo cáo nâng cao.
- Gộp/tách bill và inventory.
