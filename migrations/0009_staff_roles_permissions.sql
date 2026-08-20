PRAGMA foreign_keys = ON;

ALTER TABLE store_memberships ADD COLUMN deleted_at INTEGER;

INSERT OR IGNORE INTO permissions (key, group_key, description) VALUES
  ('order.create', 'order', 'Tạo đơn'),
  ('order.proforma_print', 'order', 'In tạm tính'),
  ('order.cancel_unpaid', 'order', 'Hủy đơn chưa thanh toán'),
  ('product.quick_create', 'order', 'Tạo nhanh mặt hàng'),
  ('time.adjust', 'order', 'Sửa thời gian sử dụng của mặt hàng tính giờ'),
  ('order.split_merge', 'order', 'Tách/gộp đơn'),
  ('order.add_customer', 'order', 'Thêm khách hàng vào đơn'),
  ('order.update_after_proforma', 'order', 'Cập nhật đơn hàng sau tạm tính'),
  ('qr_order.handle', 'order', 'Xử lý yêu cầu từ QR order'),
  ('order.discount_after_saved', 'order', 'Giảm/hủy món sau lưu'),
  ('discount.item', 'checkout', 'Giảm giá mặt hàng'),
  ('promotion.apply', 'checkout', 'Áp dụng khuyến mại cho đơn'),
  ('report.revenue', 'report', 'Báo cáo doanh thu'),
  ('report.inventory', 'report', 'Báo cáo kho hàng'),
  ('report.promotion', 'report', 'Báo cáo khuyến mại'),
  ('report.product', 'report', 'Báo cáo mặt hàng'),
  ('report.financial', 'report', 'Báo cáo tài chính'),
  ('report.staff', 'report', 'Báo cáo nhân viên'),
  ('invoice.delete', 'invoice', 'Xóa hóa đơn'),
  ('invoice.refund', 'invoice', 'Hoàn tiền hóa đơn'),
  ('invoice.export', 'invoice', 'Xuất danh sách'),
  ('invoice.cancel', 'invoice', 'Hủy hóa đơn'),
  ('catalog.products.view', 'catalog', 'Xem danh sách mặt hàng'),
  ('catalog.products.edit', 'catalog', 'Sửa mặt hàng'),
  ('catalog.products.import_export', 'catalog', 'Nhập / Xuất danh sách'),
  ('catalog.products.create', 'catalog', 'Tạo mặt hàng'),
  ('catalog.products.delete', 'catalog', 'Xóa mặt hàng'),
  ('catalog.categories.view', 'catalog', 'Xem danh sách danh mục'),
  ('catalog.categories.edit', 'catalog', 'Sửa danh mục'),
  ('catalog.categories.create', 'catalog', 'Tạo danh mục'),
  ('catalog.categories.delete', 'catalog', 'Xóa danh mục'),
  ('staff.employees.view', 'staff', 'Xem danh sách nhân viên'),
  ('staff.employees.edit', 'staff', 'Sửa nhân viên'),
  ('staff.employees.create', 'staff', 'Tạo nhân viên'),
  ('staff.employees.delete', 'staff', 'Xóa nhân viên'),
  ('customer.list.view', 'customer', 'Xem danh sách khách hàng'),
  ('customer.list.edit_debt', 'customer', 'Sửa và thu nợ khách hàng'),
  ('customer.list.import_export', 'customer', 'Nhập / Xuất danh sách khách hàng'),
  ('customer.list.create', 'customer', 'Tạo khách hàng'),
  ('customer.list.delete', 'customer', 'Xóa khách hàng'),
  ('customer.groups.view', 'customer', 'Xem danh sách nhóm khách hàng'),
  ('customer.groups.edit', 'customer', 'Sửa nhóm khách hàng'),
  ('customer.groups.create', 'customer', 'Tạo nhóm khách hàng'),
  ('customer.groups.delete', 'customer', 'Xóa nhóm khách hàng'),
  ('promotion.edit', 'promotion', 'Sửa khuyến mãi'),
  ('promotion.create', 'promotion', 'Tạo khuyến mãi'),
  ('promotion.delete', 'promotion', 'Xóa khuyến mãi');

-- Surface the existing default Employee capabilities in the new fine-grained UI.
INSERT OR IGNORE INTO role_permissions (store_id, role_id, permission_key, created_at)
SELECT r.store_id, r.id, p.key, r.updated_at
FROM roles r
JOIN permissions p ON p.key IN (
  'order.create', 'checkout.complete', 'invoice.view', 'invoice.print'
)
WHERE r.code = 'EMPLOYEE';
