import { z } from 'zod';

export const rolePermissionCatalog = [
  {
    key: 'sales',
    title: 'Nhân viên bán hàng',
    description: 'Các quyền thao tác đơn hàng, bàn và thanh toán tại POS.',
    sections: [
      {
        key: 'orders',
        title: 'Đơn hàng',
        description: 'Tạo và xử lý đơn hàng, bàn và mặt hàng tính giờ.',
        permissions: [
          ['order.create', 'Tạo đơn'],
          ['table.transfer', 'Thay đổi bàn'],
          ['order.proforma_print', 'In tạm tính'],
          ['order.cancel_unpaid', 'Hủy đơn chưa thanh toán'],
          ['product.quick_create', 'Tạo nhanh mặt hàng'],
          ['time.adjust', 'Sửa thời gian sử dụng của mặt hàng tính giờ'],
          ['order.split_merge', 'Tách/gộp đơn'],
          ['order.add_customer', 'Thêm khách hàng vào đơn'],
          ['order.update_after_proforma', 'Cập nhật đơn hàng sau tạm tính'],
          ['qr_order.handle', 'Xử lý yêu cầu từ QR order'],
          ['order.discount_after_saved', 'Giảm/hủy món sau lưu'],
          ['time.pause', 'Tạm ngừng/tiếp tục tính giờ'],
        ],
      },
      {
        key: 'payments',
        title: 'Thanh toán',
        description: 'Thanh toán, chiết khấu và áp dụng khuyến mại.',
        permissions: [
          ['checkout.complete', 'Thanh toán & hoàn tất đơn'],
          ['discount.apply', 'Chiết khấu đơn'],
          ['discount.item', 'Giảm giá mặt hàng'],
          ['promotion.apply', 'Áp dụng khuyến mại cho đơn'],
        ],
      },
    ],
  },
  {
    key: 'management',
    title: 'Quản lý cửa hàng',
    description: 'Các quyền quản lý báo cáo và dữ liệu dùng chung của cửa hàng.',
    sections: [
      {
        key: 'reports',
        title: 'Báo cáo',
        description: 'Hệ thống báo cáo doanh thu, mặt hàng, khuyến mại và nhân viên.',
        permissions: [
          ['report.revenue', 'Báo cáo doanh thu'],
          ['report.inventory', 'Báo cáo kho hàng'],
          ['report.promotion', 'Báo cáo khuyến mại'],
          ['report.product', 'Báo cáo mặt hàng'],
          ['report.financial', 'Báo cáo tài chính'],
          ['report.staff', 'Báo cáo nhân viên'],
        ],
      },
      {
        key: 'invoices',
        title: 'Hóa đơn',
        description: 'Quản lý hóa đơn đã thanh toán.',
        permissions: [
          ['invoice.view', 'Xem hóa đơn'],
          ['invoice.delete', 'Xóa hóa đơn'],
          ['invoice.refund', 'Hoàn tiền hóa đơn'],
          ['invoice.export', 'Xuất danh sách'],
          ['invoice.cancel', 'Hủy hóa đơn'],
          ['invoice.print', 'In biên lai'],
        ],
      },
      {
        key: 'products',
        title: 'Mặt hàng',
        description: 'Quản lý mặt hàng và danh mục.',
        permissions: [
          ['catalog.products.view', 'Xem danh sách mặt hàng'],
          ['catalog.products.edit', 'Sửa mặt hàng'],
          ['catalog.products.import_export', 'Nhập / Xuất danh sách'],
          ['catalog.products.create', 'Tạo mặt hàng'],
          ['catalog.products.delete', 'Xóa mặt hàng'],
          ['catalog.categories.view', 'Xem danh sách danh mục'],
          ['catalog.categories.edit', 'Sửa danh mục'],
          ['catalog.categories.create', 'Tạo danh mục'],
          ['catalog.categories.delete', 'Xóa danh mục'],
        ],
      },
      {
        key: 'staff',
        title: 'Nhân viên',
        description: 'Quản lý nhân viên và vai trò.',
        permissions: [
          ['staff.employees.view', 'Xem danh sách nhân viên'],
          ['staff.employees.edit', 'Sửa nhân viên'],
          ['staff.employees.create', 'Tạo nhân viên'],
          ['staff.employees.delete', 'Xóa nhân viên'],
        ],
      },
      {
        key: 'customers',
        title: 'Khách hàng',
        description: 'Quản lý khách hàng và nhóm khách hàng.',
        permissions: [
          ['customer.list.view', 'Xem danh sách khách hàng'],
          ['customer.list.edit_debt', 'Sửa & Thu nợ khách hàng'],
          ['customer.list.import_export', 'Nhập / Xuất danh sách'],
          ['customer.list.create', 'Tạo khách hàng'],
          ['customer.list.delete', 'Xóa khách hàng'],
          ['customer.groups.view', 'Xem danh sách nhóm khách hàng'],
          ['customer.groups.edit', 'Sửa nhóm khách hàng'],
          ['customer.groups.create', 'Tạo nhóm khách hàng'],
          ['customer.groups.delete', 'Xóa nhóm khách hàng'],
        ],
      },
      {
        key: 'promotions',
        title: 'Khuyến mãi',
        description: 'Quản lý chương trình khuyến mãi.',
        permissions: [
          ['promotion.edit', 'Sửa khuyến mãi'],
          ['promotion.create', 'Tạo khuyến mãi'],
          ['promotion.delete', 'Xóa khuyến mãi'],
        ],
      },
    ],
  },
] as const;

export const rolePermissionKeys = rolePermissionCatalog.flatMap((group) =>
  group.sections.flatMap((section) => section.permissions.map(([key]) => key)),
);

export const createEmployeeSchema = z.object({
  displayName: z.string().trim().min(1).max(128),
  username: z.string().trim().min(3).max(128),
  email: z.string().trim().email().max(254).nullable().optional(),
  pin: z.string().regex(/^\d{4}$/),
  roleId: z.uuid().optional(),
  permissionKeys: z.array(z.string().min(1)).default([]),
});

export const updateEmployeeSchema = z.object({
  displayName: z.string().trim().min(1).max(128),
  email: z.string().trim().email().max(254).nullable().optional(),
  roleId: z.uuid(),
  pin: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
});

export const employeeBulkActionSchema = z.object({
  userIds: z.array(z.uuid()).min(1).max(100),
  action: z.enum(['ACTIVATE', 'DISABLE', 'DELETE', 'REVOKE_SESSIONS']),
});

export const createRoleSchema = z.object({
  name: z.string().trim().min(1).max(128),
  permissionKeys: z.array(z.string().min(1)).default([]),
});

export const updateRoleSchema = createRoleSchema;

export type RolePermissionCatalog = typeof rolePermissionCatalog;
