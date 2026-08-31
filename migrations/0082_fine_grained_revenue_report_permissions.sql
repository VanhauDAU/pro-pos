PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO permissions (key, group_key, description) VALUES
  ('report.revenue.payment', 'report', 'Xem doanh thu theo phương thức thanh toán'),
  ('report.revenue.service', 'report', 'Xem doanh thu theo hình thức phục vụ'),
  ('report.revenue.cancelled', 'report', 'Xem báo cáo hủy đơn'),
  ('report.revenue.staff', 'report', 'Xem doanh thu theo nhân viên'),
  ('report.revenue.export', 'report', 'Xuất báo cáo doanh thu'),
  ('report.revenue.print', 'report', 'In báo cáo doanh thu');

