import type {
  DatabaseStorageReport,
  PlatformStoreDetail,
  PlatformStoreSummary,
} from '@contracts/platform';
import type { BuiltMessage, TelegramInlineKeyboardButton } from './telegram-types';

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  if (i === 0) return `${Math.round(bytes)} B`;

  const val = bytes / Math.pow(k, i);
  let formatted: string;
  if (val < 10) {
    formatted = val.toFixed(2).replace(/\.?0+$/, '');
  } else if (val < 100) {
    formatted = val.toFixed(1).replace(/\.?0+$/, '');
  } else {
    formatted = Math.round(val).toString();
  }

  return `${formatted} ${sizes[i]}`;
}

export function formatVnd(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '0 ₫';
  return new Intl.NumberFormat('vi-VN').format(Math.round(amount)) + ' ₫';
}

export function formatDateTime(timestamp: number, timeZone = 'Asia/Ho_Chi_Minh'): string {
  try {
    const date = new Date(timestamp);
    const formatter = new Intl.DateTimeFormat('vi-VN', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return formatter.format(date);
  } catch {
    return new Date(timestamp).toISOString();
  }
}

export interface StatusMetrics {
  environment: string;
  activeStoresCount: number;
  lockedStoresCount: number;
  databaseSizeBytes: number | null;
  realtimePendingCount?: number;
  abnormalPrintJobsCount?: number;
  updatedAt: number;
}

export function buildHomeMessage(displayName?: string): BuiltMessage {
  const greeting = displayName ? `Xin chào ${displayName}.` : 'Xin chào.';
  const text = ['🤖 PRO POS Admin', '', greeting, 'Chọn nội dung bạn muốn kiểm tra:'].join('\n');

  const replyMarkup = {
    inline_keyboard: [
      [{ text: '🟢 Tình trạng hệ thống', callback_data: 'menu:status' }],
      [
        { text: '💾 Cơ sở dữ liệu', callback_data: 'menu:db' },
        { text: '🏪 Cửa hàng', callback_data: 'menu:stores' },
      ],
      [
        { text: '🚀 Phiên bản', callback_data: 'menu:version' },
        { text: '❓ Trợ giúp', callback_data: 'menu:help' },
      ],
    ],
  };

  return { text, replyMarkup };
}

export function buildStatusMessage(metrics: StatusMetrics): BuiltMessage {
  const envName =
    metrics.environment === 'production'
      ? 'Production'
      : metrics.environment === 'staging'
        ? 'Staging'
        : 'Local';

  const dbSizeFormatted = metrics.databaseSizeBytes
    ? formatBytes(metrics.databaseSizeBytes)
    : 'Không khả dụng';

  const text = [
    '🟢 PRO POS — Tình trạng hệ thống',
    '',
    `Môi trường: ${envName}`,
    `Cửa hàng hoạt động: ${metrics.activeStoresCount}`,
    `Cửa hàng bị khóa: ${metrics.lockedStoresCount}`,
    '',
    'Cơ sở dữ liệu:',
    dbSizeFormatted,
    '',
    'Realtime pending:',
    `${metrics.realtimePendingCount ?? 0}`,
    '',
    'Print jobs bất thường:',
    `${metrics.abnormalPrintJobsCount ?? 0}`,
    '',
    'Trạng thái:',
    '✅ Bình thường',
    '',
    `Cập nhật: ${formatDateTime(metrics.updatedAt)}`,
  ].join('\n');

  const replyMarkup = {
    inline_keyboard: [
      [{ text: '🔄 Làm mới', callback_data: 'status:refresh' }],
      [
        { text: '💾 Database', callback_data: 'menu:db' },
        { text: '🏪 Cửa hàng', callback_data: 'menu:stores' },
      ],
      [{ text: '⬅️ Menu chính', callback_data: 'menu:home' }],
    ],
  };

  return { text, replyMarkup };
}

export function buildDatabaseMessage(
  report: DatabaseStorageReport,
  adminWebUrl?: string,
): BuiltMessage {
  const totalSize = report.databaseSizeBytes
    ? formatBytes(report.databaseSizeBytes)
    : formatBytes(report.totalEstimatedDataBytes);
  const estData = formatBytes(report.totalEstimatedDataBytes);

  const top5 = report.tables.slice(0, 5);
  const topLines: string[] = [];
  top5.forEach((tbl, idx) => {
    topLines.push(`${idx + 1}. ${tbl.tableName}`);
    topLines.push(`   ~${formatBytes(tbl.estimatedDataBytes)} · ${tbl.rowCount} records`);
  });

  const lines = [
    '💾 PRO POS — Cơ sở dữ liệu',
    '',
    'Tổng dung lượng:',
    totalSize,
    '',
    'Dữ liệu ước tính:',
    estData,
    '',
    `Số bảng: ${report.tableCount}`,
    '',
    'Top bảng:',
    ...topLines,
    '',
    'Lưu ý: Dung lượng từng bảng là ước tính logic.',
  ];

  const keyboard: TelegramInlineKeyboardButton[][] = [
    [
      { text: '🔄 Phân tích lại', callback_data: 'db:refresh' },
      { text: '📋 Xem Top 10', callback_data: 'db:top' },
    ],
  ];

  if (adminWebUrl) {
    keyboard.push([
      {
        text: '🌐 Mở trang Cơ sở dữ liệu',
        url: `${adminWebUrl}/platform?tab=database`,
      },
    ]);
  }

  keyboard.push([{ text: '⬅️ Menu chính', callback_data: 'menu:home' }]);

  return { text: lines.join('\n'), replyMarkup: { inline_keyboard: keyboard } };
}

export function buildDatabaseTopMessage(report: DatabaseStorageReport): BuiltMessage {
  const top10 = report.tables.slice(0, 10);
  const lines: string[] = ['💾 PRO POS — Top 10 Bảng Cơ sở dữ liệu', ''];

  top10.forEach((tbl, idx) => {
    lines.push(`#${idx + 1} ${tbl.tableName}`);
    lines.push(`~${formatBytes(tbl.estimatedDataBytes)}`);
    lines.push(`${tbl.rowCount} records`);
    lines.push(`Phân loại: ${tbl.category}`);
    lines.push(`Retention: ${tbl.retentionLabel}`);
    lines.push('');
  });

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '🔄 Làm mới', callback_data: 'db:top' },
        { text: '💾 Tổng quan DB', callback_data: 'menu:db' },
      ],
      [{ text: '⬅️ Menu chính', callback_data: 'menu:home' }],
    ],
  };

  return { text: lines.join('\n').trim(), replyMarkup };
}

export function buildStoresMessage(
  stores: PlatformStoreSummary[],
  page = 1,
  pageSize = 8,
): BuiltMessage {
  const total = stores.length;
  const activeCount = stores.filter((s) => s.status === 'ACTIVE').length;
  const lockedCount = total - activeCount;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const currentStores = stores.slice(startIndex, startIndex + pageSize);

  const storeLines = currentStores.map((s, idx) => {
    const icon = s.status === 'ACTIVE' ? '🟢' : '🔒';
    return `${startIndex + idx + 1}. ${s.name}\n   ${icon} ${s.status}`;
  });

  const lines = [
    '🏪 PRO POS — Cửa hàng',
    '',
    `Tổng: ${total}`,
    `🟢 Hoạt động: ${activeCount}`,
    `🔒 Đã khóa: ${lockedCount}`,
    ...(totalPages > 1 ? [`Trang: ${currentPage}/${totalPages}`] : []),
    '',
    ...storeLines,
  ];

  const keyboard: TelegramInlineKeyboardButton[][] = [];

  // Store selection buttons (1 store per row for clear readable tap targets)
  for (const s of currentStores) {
    keyboard.push([
      {
        text: `🏪 ${s.name}`,
        callback_data: `store:view:${s.id}`,
      },
    ]);
  }

  // Pagination if more than 1 page
  if (totalPages > 1) {
    const pageButtons: TelegramInlineKeyboardButton[] = [];
    if (currentPage > 1) {
      pageButtons.push({
        text: '◀️ Trang trước',
        callback_data: `stores:page:${currentPage - 1}`,
      });
    }
    if (currentPage < totalPages) {
      pageButtons.push({
        text: 'Trang sau ▶️',
        callback_data: `stores:page:${currentPage + 1}`,
      });
    }
    keyboard.push(pageButtons);
  }

  keyboard.push([
    { text: '🔄 Làm mới', callback_data: 'stores:refresh' },
    { text: '⬅️ Menu chính', callback_data: 'menu:home' },
  ]);

  return { text: lines.join('\n'), replyMarkup: { inline_keyboard: keyboard } };
}

export function buildStoreDetailMessage(detail: PlatformStoreDetail): BuiltMessage {
  const { store, members, devices, sessions, stats, analytics } = detail;
  const activeSessions = sessions.filter((s) => s.status === 'ACTIVE' && s.isOnline).length;
  const onlineDevices = devices.filter((d) => d.isOnline).length;
  const offlineDevices = devices.filter((d) => !d.isOnline && d.status === 'ACTIVE').length;
  const todayRevenue = analytics?.summary?.todayRevenue ?? 0;
  const todayInvoices = stats.todayInvoices ?? analytics?.summary?.todayInvoices ?? 0;
  const todayOrders = stats.todayOrders ?? analytics?.summary?.todayOrders ?? todayInvoices;

  const statusText = store.status === 'ACTIVE' ? '🟢 Hoạt động (ACTIVE)' : '🔒 Tạm khóa (LOCKED)';
  const phoneText = store.settings?.phone ? `\n📞 Hotline: ${store.settings.phone}` : '';
  const addressParts = [
    store.settings?.address,
    store.settings?.wardName,
    store.settings?.provinceName,
  ].filter(Boolean);
  const addressText = addressParts.length > 0 ? `\n📍 Địa chỉ: ${addressParts.join(', ')}` : '';

  const totalTables = stats.totalTables || 0;
  const openTables = stats.openTables || 0;
  const emptyTables = Math.max(0, totalTables - openTables);

  const lines = [
    `🏪 ${store.name}`,
    `Trạng thái: ${statusText}${phoneText}${addressText}`,
    `📅 Ngày tạo: ${formatDateTime(store.createdAt)}`,
    '',
    '🎱 VẬN HÀNH BÀN & THỰC ĐƠN',
    `• Bàn bida: ${totalTables} bàn (⚡ ${openTables} đang chơi | 💤 ${emptyTables} trống)`,
    `• Khu vực: ${stats.totalAreas || 0} khu vực`,
    `• Thực đơn: ${stats.totalProducts || 0} món (${stats.activeProductsCount ?? stats.totalProducts ?? 0} đang bán | ${stats.totalCategories ?? 0} danh mục)`,
    '',
    '💰 DOANH THU & ĐƠN HÀNG',
    `• Doanh thu hôm nay: ${formatVnd(todayRevenue)}`,
    `• Hóa đơn hôm nay: ${todayInvoices} HĐ (${todayOrders} order)`,
    `• Đơn đang mở: ${stats.openOrders || 0} đơn đang phục vụ`,
    `• Giá trị TB / HĐ: ${formatVnd(analytics?.summary?.avgInvoiceValue || 0)}`,
    `• 7 ngày qua: ${formatVnd(analytics?.summary?.last7DaysRevenue ?? 0)}`,
    `• 30 ngày qua: ${formatVnd(analytics?.summary?.last30DaysRevenue ?? 0)}`,
    `• Tổng lũy kế: ${formatVnd(stats.totalRevenue || 0)} (${stats.totalInvoices || 0} HĐ)`,
    `• Tỷ lệ hoàn thành: ${analytics?.summary?.completionRate ?? 100}% (${stats.dineInOrders ?? 0} tại bàn | ${stats.takeawayOrders ?? 0} mang về)`,
  ];

  if ((stats.cancelledOrders ?? 0) > 0) {
    lines.push(`• Đơn đã hủy: ${stats.cancelledOrders} (${stats.cancelRate ?? 0}%)`);
  }
  if ((stats.totalDiscountAmount ?? 0) > 0) {
    lines.push(`• Tổng giảm giá / chiết khấu: ${formatVnd(stats.totalDiscountAmount)}`);
  }

  lines.push(
    '',
    '💻 THIẾT BỊ & NHÂN SỰ',
    `• Thiết bị POS: ${devices.length} máy (🟢 ${onlineDevices} online | ⚪ ${offlineDevices} offline)`,
    `• Nhân sự: ${members.length} nhân viên (${members.filter((m) => m.userStatus === 'ACTIVE').length} active)`,
    `• Phiên đăng nhập: ${activeSessions} active`,
    `• Realtime POS: ${store.posRealtimeEnabled ? '🟢 Bật' : '⚪ Tắt'}`,
  );

  if (store.settings?.bankName && store.settings.bankAccountNumber) {
    lines.push(
      '',
      '💳 TÀI KHOẢN THANH TOÁN',
      `• Ngân hàng: ${store.settings.bankName} - ${store.settings.bankAccountNumber} (${store.settings.bankAccountName || 'Chưa cập nhật'})`,
    );
  }

  if ((stats.totalCustomers ?? 0) > 0 || (stats.totalDebtBalance ?? 0) > 0) {
    lines.push(
      '',
      '👥 KHÁCH HÀNG & CÔNG NỢ',
      `• Tổng khách hàng: ${stats.totalCustomers ?? 0}`,
      `• Công nợ chưa thu: ${formatVnd(stats.totalDebtBalance ?? 0)}`,
    );
  }

  if (stats.lastActivityAt) {
    lines.push('', `⚡ Hoạt động gần nhất: ${formatDateTime(stats.lastActivityAt)}`);
  }

  lines.push('', `⏱ Cập nhật: ${formatDateTime(Date.now())}`);

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '📊 Doanh thu & Top món', callback_data: `store:analytics:${store.id}` },
        { text: '💻 Thiết bị POS', callback_data: `store:devices:${store.id}` },
      ],
      [
        { text: '👥 Đội ngũ Nhân sự', callback_data: `store:staff:${store.id}` },
        { text: '⚙️ Cấu hình & Bank', callback_data: `store:settings:${store.id}` },
      ],
      [{ text: '🔄 Làm mới số liệu', callback_data: `store:refresh:${store.id}` }],
      [
        { text: '⬅️ Danh sách cửa hàng', callback_data: 'menu:stores' },
        { text: '🏠 Menu chính', callback_data: 'menu:home' },
      ],
    ],
  };

  return { text: lines.join('\n'), replyMarkup };
}

export function buildStoreAnalyticsMessage(detail: PlatformStoreDetail): BuiltMessage {
  const { store, stats, analytics } = detail;
  const summary = analytics?.summary;
  const topProducts = analytics?.topProducts ?? [];
  const paymentMethods = analytics?.paymentMethods ?? [];

  const lines = [
    '📊 PRO POS — Doanh thu & Phân tích',
    `🏪 ${store.name}`,
    '',
    '💰 DOANH SỐ & HÓA ĐƠN',
    `• Doanh thu hôm nay: ${formatVnd(summary?.todayRevenue ?? 0)}`,
    `• Hóa đơn hôm nay: ${stats.todayInvoices ?? summary?.todayInvoices ?? 0} HĐ (${stats.todayOrders ?? summary?.todayOrders ?? 0} order)`,
    `• Giá trị TB / HĐ: ${formatVnd(summary?.avgInvoiceValue ?? 0)}`,
    `• 7 ngày qua: ${formatVnd(summary?.last7DaysRevenue ?? 0)}`,
    `• 30 ngày qua: ${formatVnd(summary?.last30DaysRevenue ?? 0)}`,
    `• Tổng lũy kế: ${formatVnd(stats.totalRevenue || 0)} (${stats.totalInvoices || 0} HĐ)`,
    '',
    '📈 HIỆU SUẤT ĐƠN HÀNG',
    `• Tỷ lệ hoàn thành: ${summary?.completionRate ?? 100}%`,
    `• Đơn tại bàn: ${stats.dineInOrders ?? 0} | Mang về: ${stats.takeawayOrders ?? 0}`,
    `• Đơn bị hủy: ${stats.cancelledOrders ?? 0} đơn (${stats.cancelRate ?? 0}%)`,
    `• Đang phục vụ: ${stats.openOrders ?? 0} đơn`,
  ];

  if ((stats.totalDiscountAmount ?? 0) > 0) {
    lines.push(`• Tổng giảm giá đã cấp: ${formatVnd(stats.totalDiscountAmount)}`);
  }

  lines.push('', '💳 PHƯƠNG THỨC THANH TOÁN');
  if (paymentMethods.length === 0) {
    lines.push('• Chưa ghi nhận giao dịch thanh toán nào');
  } else {
    for (const pm of paymentMethods) {
      const label =
        pm.method === 'CASH'
          ? '💵 Tiền mặt'
          : pm.method === 'BANK_TRANSFER'
            ? '📲 Chuyển khoản QR'
            : pm.method === 'CARD'
              ? '💳 Thẻ'
              : `🔸 ${pm.method}`;
      lines.push(`• ${label}: ${formatVnd(pm.totalAmount)} (${pm.count} GD)`);
    }
  }

  lines.push('', '🏆 TOP MÓN BÁN CHẠY');
  if (topProducts.length === 0) {
    lines.push('• Chưa có dữ liệu món bán');
  } else {
    topProducts.slice(0, 8).forEach((p, idx) => {
      lines.push(`${idx + 1}. ${p.name}`);
      lines.push(`   ↳ ${p.totalQuantity} phần · ${formatVnd(p.totalRevenue)}`);
    });
  }

  lines.push('', `⏱ Cập nhật: ${formatDateTime(Date.now())}`);

  const replyMarkup = {
    inline_keyboard: [
      [{ text: '🔄 Làm mới', callback_data: `store:analytics:${store.id}` }],
      [
        { text: '⬅️ Về tổng quan quán', callback_data: `store:view:${store.id}` },
        { text: '🏠 Menu chính', callback_data: 'menu:home' },
      ],
    ],
  };

  return { text: lines.join('\n'), replyMarkup };
}

export function buildStoreDevicesMessage(detail: PlatformStoreDetail): BuiltMessage {
  const { store, devices } = detail;
  const onlineCount = devices.filter((d) => d.isOnline).length;
  const offlineCount = devices.filter((d) => !d.isOnline && d.status === 'ACTIVE').length;
  const revokedCount = devices.filter((d) => d.status === 'REVOKED').length;

  const lines = [
    '💻 PRO POS — Thiết bị POS',
    `🏪 ${store.name}`,
    '',
    `Tổng thiết bị: ${devices.length} máy`,
    `🟢 Online: ${onlineCount} | ⚪ Offline: ${offlineCount}${revokedCount > 0 ? ` | ⛔ Đã thu hồi: ${revokedCount}` : ''}`,
    '',
  ];

  if (devices.length === 0) {
    lines.push('Chưa có thiết bị POS nào được kích hoạt.');
  } else {
    const displayDevices = devices.slice(0, 10);
    displayDevices.forEach((dev, idx) => {
      const statusIcon =
        dev.status === 'REVOKED' ? '⛔ Đã thu hồi' : dev.isOnline ? '🟢 Online' : '⚪ Offline';
      lines.push(`#${idx + 1} 💻 ${dev.name}`);
      lines.push(`   • Trạng thái: ${statusIcon}`);
      if (dev.currentSession) {
        lines.push(
          `   • Người trực ca: ${dev.currentSession.userName} (${dev.currentSession.userRoleName || 'Nhân viên'})`,
        );
      } else {
        lines.push('   • Người trực ca: Không có phiên live');
      }
      lines.push(`   • Kích hoạt bởi: ${dev.activatedByName} (${formatDateTime(dev.activatedAt)})`);
      if (dev.lastSeenAt) {
        lines.push(`   • Lần cuối: ${formatDateTime(dev.lastSeenAt)}`);
      }
      lines.push(`   • Push notify: ${dev.pushNotificationEnabled ? 'Bật' : 'Tắt'}`);
      lines.push('');
    });

    if (devices.length > 10) {
      lines.push(`(và ${devices.length - 10} thiết bị khác...)`, '');
    }
  }

  lines.push(`⏱ Cập nhật: ${formatDateTime(Date.now())}`);

  const replyMarkup = {
    inline_keyboard: [
      [{ text: '🔄 Làm mới', callback_data: `store:devices:${store.id}` }],
      [
        { text: '⬅️ Về tổng quan quán', callback_data: `store:view:${store.id}` },
        { text: '🏠 Menu chính', callback_data: 'menu:home' },
      ],
    ],
  };

  return { text: lines.join('\n'), replyMarkup };
}

export function buildStoreStaffMessage(detail: PlatformStoreDetail): BuiltMessage {
  const { store, members } = detail;
  const activeMembers = members.filter(
    (m) => m.userStatus === 'ACTIVE' && m.membershipStatus === 'ACTIVE',
  );

  const lines = [
    '👥 PRO POS — Đội ngũ Nhân sự',
    `🏪 ${store.name}`,
    '',
    `Tổng nhân sự: ${members.length} người (${activeMembers.length} đang hoạt động)`,
    '',
  ];

  if (members.length === 0) {
    lines.push('Chưa có nhân viên nào trong cửa hàng.');
  } else {
    const displayMembers = members.slice(0, 12);
    displayMembers.forEach((m, idx) => {
      const statusIcon = m.userStatus === 'ACTIVE' && m.membershipStatus === 'ACTIVE' ? '🟢' : '🔒';
      const rolePrefix = m.roleCode === 'OWNER' ? '👑' : m.roleCode === 'MANAGER' ? '⭐' : '👤';
      lines.push(`#${idx + 1} ${rolePrefix} ${m.displayName} (@${m.username})`);
      lines.push(`   • Chức vụ: ${m.roleName}`);
      lines.push(`   • Trạng thái: ${statusIcon} ${m.userStatus}`);
      if (m.phone) {
        lines.push(`   • SĐT: ${m.phone}`);
      }
      if (m.email) {
        lines.push(`   • Email: ${m.email}`);
      }
      lines.push(`   • Tham gia: ${formatDateTime(m.createdAt)}`);
      lines.push('');
    });

    if (members.length > 12) {
      lines.push(`(và ${members.length - 12} nhân viên khác...)`, '');
    }
  }

  lines.push(`⏱ Cập nhật: ${formatDateTime(Date.now())}`);

  const replyMarkup = {
    inline_keyboard: [
      [{ text: '🔄 Làm mới', callback_data: `store:staff:${store.id}` }],
      [
        { text: '⬅️ Về tổng quan quán', callback_data: `store:view:${store.id}` },
        { text: '🏠 Menu chính', callback_data: 'menu:home' },
      ],
    ],
  };

  return { text: lines.join('\n'), replyMarkup };
}

export function buildStoreSettingsMessage(detail: PlatformStoreDetail): BuiltMessage {
  const { store, stats } = detail;
  const s = store.settings;
  const statusText = store.status === 'ACTIVE' ? '🟢 Hoạt động (ACTIVE)' : '🔒 Tạm khóa (LOCKED)';
  const addressParts = [s?.address, s?.wardName, s?.provinceName].filter(Boolean);

  const lines = [
    '⚙️ PRO POS — Cấu hình & Thông tin',
    `🏪 ${store.name}`,
    '',
    '📍 THÔNG TIN ĐỊA ĐIỂM & LIÊN HỆ',
    `• Tên cửa hàng: ${store.name}`,
    `• Mã hệ thống (ID): ${store.id}`,
    `• Trạng thái: ${statusText}`,
    `• Hotline: ${s?.phone || 'Chưa thiết lập'}`,
    `• Địa chỉ: ${addressParts.length > 0 ? addressParts.join(', ') : 'Chưa thiết lập'}`,
    '',
    '⚙️ THIẾT LẬP VẬN HÀNH',
    `• Múi giờ: ${store.timezone || 'Asia/Ho_Chi_Minh'}`,
    `• Tiền tệ: ${s?.currency || 'VND'}`,
    `• POS Realtime: ${store.posRealtimeEnabled ? '🟢 Đang bật (Đồng bộ tức thì)' : '⚪ Tắt'}`,
    `• Giờ chốt ngày: ${s?.businessDayCutoffMinutes ? `+${s.businessDayCutoffMinutes} phút` : 'Mặc định (00:00)'}`,
    `• Số khu vực: ${stats.totalAreas || 0} | Số danh mục: ${stats.totalCategories || 0}`,
    '',
    '💳 TÀI KHOẢN NGÂN HÀNG & QR',
  ];

  if (s?.bankName && s.bankAccountNumber) {
    lines.push(
      `• Ngân hàng: ${s.bankName}`,
      `• Số tài khoản: ${s.bankAccountNumber}`,
      `• Tên chủ tài khoản: ${s.bankAccountName || 'Chưa cập nhật'}`,
      `• Mã QR thanh toán: ${s.bankQrMediaId ? '🟢 Đã cấu hình' : '⚪ Chưa tạo mã QR'}`,
    );
  } else {
    lines.push('• Chưa thiết lập tài khoản ngân hàng nhận chuyển khoản');
  }

  lines.push(
    '',
    '📅 LỊCH SỬ',
    `• Ngày khởi tạo: ${formatDateTime(store.createdAt)}`,
    `• Cập nhật gần nhất: ${formatDateTime(store.updatedAt)}`,
    ...(stats.lastActivityAt
      ? [`• Giao dịch/phiên gần nhất: ${formatDateTime(stats.lastActivityAt)}`]
      : []),
    '',
    `⏱ Cập nhật: ${formatDateTime(Date.now())}`,
  );

  const replyMarkup = {
    inline_keyboard: [
      [{ text: '🔄 Làm mới', callback_data: `store:settings:${store.id}` }],
      [
        { text: '⬅️ Về tổng quan quán', callback_data: `store:view:${store.id}` },
        { text: '🏠 Menu chính', callback_data: 'menu:home' },
      ],
    ],
  };

  return { text: lines.join('\n'), replyMarkup };
}

export function buildVersionMessage(bindings: {
  ENVIRONMENT?: string;
  APP_VERSION?: string;
  BUILD_SHA?: string;
  BUILD_TIME?: string;
}): BuiltMessage {
  const text = [
    '🚀 PRO POS',
    '',
    'Environment:',
    bindings.ENVIRONMENT || 'production',
    '',
    'Version:',
    bindings.APP_VERSION || '0.1.0',
    '',
    'Commit:',
    bindings.BUILD_SHA || 'unknown',
    '',
    'Built:',
    bindings.BUILD_TIME || 'unknown',
  ].join('\n');

  const replyMarkup = {
    inline_keyboard: [
      [{ text: '🔄 Làm mới', callback_data: 'menu:version' }],
      [{ text: '⬅️ Menu chính', callback_data: 'menu:home' }],
    ],
  };

  return { text, replyMarkup };
}

export function buildHelpMessage(): BuiltMessage {
  const text = [
    '❓ PRO POS Admin Bot',
    '',
    'Bạn có thể:',
    '• Kiểm tra tình trạng hệ thống',
    '• Theo dõi dung lượng database',
    '• Xem các bảng lớn nhất',
    '• Xem danh sách cửa hàng',
    '• Kiểm tra phiên bản production',
    '',
    'Các thao tác thay đổi dữ liệu phải thực hiện trên SUPER_ADMIN web.',
    '',
    'Commands:',
    '/start - Mở PRO POS Admin',
    '/menu - Menu chính',
    '/status - Tình trạng hệ thống',
    '/db - Cơ sở dữ liệu',
    '/stores - Cửa hàng',
    '/version - Phiên bản',
    '/help - Trợ giúp',
  ].join('\n');

  const replyMarkup = {
    inline_keyboard: [[{ text: '🏠 Menu chính', callback_data: 'menu:home' }]],
  };

  return { text, replyMarkup };
}

export function buildUnauthorizedMessage(): BuiltMessage {
  return {
    text: '⛔ Bạn không có quyền sử dụng bot quản trị PRO POS.',
    replyMarkup: {
      inline_keyboard: [],
    },
  };
}

export function buildUnlinkedStartMessage(botUsername = 'Proposbida_bot'): BuiltMessage {
  const text = [
    '🤖 PRO POS Admin',
    '',
    'Tài khoản Telegram của bạn chưa được liên kết với hệ thống PRO POS.',
    '',
    'Để kết nối:',
    '1. Đăng nhập vào trang Quản trị viên (SUPER_ADMIN) trên Web.',
    '2. Vào mục "Telegram Bot Quản trị viên".',
    '3. Bấm "Tạo mã kết nối Telegram" và mở liên kết.',
    '',
    `Bot: @${botUsername}`,
  ].join('\n');

  return {
    text,
    replyMarkup: {
      inline_keyboard: [],
    },
  };
}

export function buildPairingSuccessMessage(displayName: string): BuiltMessage {
  const text = [
    '🎉 Kết nối thành công!',
    '',
    `Xin chào Quản trị viên ${displayName}.`,
    'Tài khoản Telegram của bạn đã được liên kết với PRO POS.',
  ].join('\n');

  return {
    text,
    replyMarkup: {
      inline_keyboard: [[{ text: '🚀 Mở Menu Quản trị', callback_data: 'menu:home' }]],
    },
  };
}

export function buildErrorMessage(reason?: string): BuiltMessage {
  const text = [
    '⚠️ Không thể tải dữ liệu lúc này.',
    reason ? `Chi tiết: ${reason}` : '',
    'Hoạt động POS không bị ảnh hưởng.',
  ]
    .filter(Boolean)
    .join('\n');

  const replyMarkup = {
    inline_keyboard: [
      [{ text: '🔄 Thử lại', callback_data: 'menu:home' }],
      [{ text: '⬅️ Menu chính', callback_data: 'menu:home' }],
    ],
  };

  return { text, replyMarkup };
}
