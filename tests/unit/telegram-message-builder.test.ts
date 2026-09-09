import { describe, expect, it } from 'vitest';

import type {
  DatabaseStorageReport,
  PlatformStoreDetail,
  PlatformStoreSummary,
} from '@contracts/platform';
import {
  buildDatabaseMessage,
  buildDatabaseTopMessage,
  buildHelpMessage,
  buildHomeMessage,
  buildStatusMessage,
  buildStoreAnalyticsMessage,
  buildStoreDetailMessage,
  buildStoreDevicesMessage,
  buildStoreSettingsMessage,
  buildStoreStaffMessage,
  buildStoresMessage,
  buildVersionMessage,
  formatBytes,
  formatVnd,
} from '@server/integrations/telegram/telegram-message-builder';

describe('Telegram Message Builders', () => {
  it('formats bytes correctly into human-readable units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(null)).toBe('0 B');
    expect(formatBytes(undefined)).toBe('0 B');
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(679936)).toBe('664 KB');
    expect(formatBytes(7361536)).toBe('7.02 MB');
    expect(formatBytes(2576980377)).toBe('2.4 GB');
  });

  it('formats VND currency with ₫ suffix', () => {
    expect(formatVnd(0)).toBe('0 ₫');
    expect(formatVnd(null)).toBe('0 ₫');
    expect(formatVnd(12450000)).toBe('12.450.000 ₫');
    expect(formatVnd(50000)).toBe('50.000 ₫');
  });

  it('builds Home dashboard message with expected buttons and <= 64-byte callbacks', () => {
    const msg = buildHomeMessage('Lê Văn Hậu');
    expect(msg.text).toContain('🤖 PRO POS Admin');
    expect(msg.text).toContain('Lê Văn Hậu');

    const flatButtons = msg.replyMarkup.inline_keyboard.flat();
    expect(flatButtons.length).toBe(5);
    expect(flatButtons.map((b) => b.callback_data)).toEqual([
      'menu:status',
      'menu:db',
      'menu:stores',
      'menu:version',
      'menu:help',
    ]);

    for (const b of flatButtons) {
      expect(new TextEncoder().encode(b.callback_data!).length).toBeLessThanOrEqual(64);
    }
  });

  it('builds Status message with metrics and navigation buttons', () => {
    const msg = buildStatusMessage({
      environment: 'production',
      activeStoresCount: 8,
      lockedStoresCount: 1,
      databaseSizeBytes: 7361536,
      realtimePendingCount: 0,
      abnormalPrintJobsCount: 0,
      updatedAt: 1700000000000,
    });

    expect(msg.text).toContain('🟢 PRO POS — Tình trạng hệ thống');
    expect(msg.text).toContain('Môi trường: Production');
    expect(msg.text).toContain('Cửa hàng hoạt động: 8');
    expect(msg.text).toContain('Cửa hàng bị khóa: 1');
    expect(msg.text).toContain('7.02 MB');
    expect(msg.text).toContain('Realtime pending:\n0');

    const flatButtons = msg.replyMarkup.inline_keyboard.flat();
    expect(flatButtons.map((b) => b.callback_data)).toEqual([
      'status:refresh',
      'menu:db',
      'menu:stores',
      'menu:home',
    ]);
  });

  it('builds Database overview message with Top 5 tables and web URL button', () => {
    const mockReport: DatabaseStorageReport = {
      capturedAt: 1700000000000,
      databaseSizeBytes: 7361536,
      tableCount: 87,
      totalEstimatedDataBytes: 5033164,
      tables: [
        {
          tableName: 'pos_save_commands',
          rowCount: 193,
          estimatedDataBytes: 1268776,
          averageRowBytes: 6573,
          estimatedSharePercent: 25.2,
          indexCount: 2,
          category: 'OPERATIONAL',
          retentionDays: 7,
          retentionLabel: '7 ngày',
          automaticallyCleaned: true,
        },
        {
          tableName: 'payment_snapshots',
          rowCount: 146,
          estimatedDataBytes: 679936,
          averageRowBytes: 4657,
          estimatedSharePercent: 13.5,
          indexCount: 3,
          category: 'OPERATIONAL',
          retentionDays: 14,
          retentionLabel: '14 ngày',
          automaticallyCleaned: true,
        },
      ],
    };

    const msg = buildDatabaseMessage(mockReport, 'https://admin.propos.vn');
    expect(msg.text).toContain('💾 PRO POS — Cơ sở dữ liệu');
    expect(msg.text).toContain('7.02 MB');
    expect(msg.text).toContain('Số bảng: 87');
    expect(msg.text).toContain('pos_save_commands');
    expect(msg.text).toContain('payment_snapshots');

    const flatButtons = msg.replyMarkup.inline_keyboard.flat();
    const urlBtn = flatButtons.find((b) => b.url);
    expect(urlBtn?.url).toBe('https://admin.propos.vn/platform?tab=database');
    expect(flatButtons.some((b) => b.callback_data === 'db:refresh')).toBe(true);
    expect(flatButtons.some((b) => b.callback_data === 'db:top')).toBe(true);
    expect(flatButtons.some((b) => b.callback_data === 'menu:home')).toBe(true);
  });

  it('builds Database Top 10 message with categories and retention labels', () => {
    const mockReport: DatabaseStorageReport = {
      capturedAt: 1700000000000,
      databaseSizeBytes: 7361536,
      tableCount: 2,
      totalEstimatedDataBytes: 5033164,
      tables: [
        {
          tableName: 'pos_save_commands',
          rowCount: 193,
          estimatedDataBytes: 1268776,
          averageRowBytes: 6573,
          estimatedSharePercent: 25.2,
          indexCount: 2,
          category: 'OPERATIONAL',
          retentionDays: 7,
          retentionLabel: '7 ngày',
          automaticallyCleaned: true,
        },
        {
          tableName: 'invoices',
          rowCount: 87,
          estimatedDataBytes: 356352,
          averageRowBytes: 4096,
          estimatedSharePercent: 7.1,
          indexCount: 4,
          category: 'FINANCIAL',
          retentionDays: null,
          retentionLabel: 'Không tự động xóa',
          automaticallyCleaned: false,
        },
      ],
    };

    const msg = buildDatabaseTopMessage(mockReport);
    expect(msg.text).toContain('💾 PRO POS — Top 10 Bảng Cơ sở dữ liệu');
    expect(msg.text).toContain('#1 pos_save_commands');
    expect(msg.text).toContain('Phân loại: OPERATIONAL');
    expect(msg.text).toContain('#2 invoices');
    expect(msg.text).toContain('Phân loại: FINANCIAL');
    expect(msg.text).toContain('Retention: Không tự động xóa');
  });

  it('builds Stores list message and ensures callback_data <= 64 bytes with UUIDs', () => {
    const mockStores: PlatformStoreSummary[] = [
      {
        id: '11111111-2222-3333-4444-555555555555',
        name: 'Coffee ABC',
        status: 'ACTIVE',
        timezone: 'Asia/Ho_Chi_Minh',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        posRealtimeEnabled: true,
      },
      {
        id: '99999999-8888-7777-6666-555555555555',
        name: 'Billiards Club',
        status: 'LOCKED',
        timezone: 'Asia/Ho_Chi_Minh',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        posRealtimeEnabled: false,
      },
    ];

    const msg = buildStoresMessage(mockStores);
    expect(msg.text).toContain('🏪 PRO POS — Cửa hàng');
    expect(msg.text).toContain('Tổng: 2');
    expect(msg.text).toContain('Coffee ABC');
    expect(msg.text).toContain('Billiards Club');

    const flatButtons = msg.replyMarkup.inline_keyboard.flat();
    const storeBtn = flatButtons.find((b) => b.callback_data?.startsWith('store:view:'));
    expect(storeBtn?.callback_data).toBe('store:view:11111111-2222-3333-4444-555555555555');

    for (const b of flatButtons) {
      if (b.callback_data) {
        expect(new TextEncoder().encode(b.callback_data).length).toBeLessThanOrEqual(64);
      }
    }
  });

  it('builds Store detail message with financial metrics and navigation', () => {
    const mockDetail: PlatformStoreDetail = {
      store: {
        id: '11111111-2222-3333-4444-555555555555',
        name: 'Coffee ABC',
        status: 'ACTIVE',
        timezone: 'Asia/Ho_Chi_Minh',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        posRealtimeEnabled: true,
        settings: null,
      },
      members: [
        {
          id: 'm-1',
          userId: 'u-1',
          username: 'manager',
          displayName: 'Manager',
          email: null,
          phone: null,
          userStatus: 'ACTIVE',
          membershipStatus: 'ACTIVE',
          roleCode: 'MANAGER',
          roleName: 'Quản lý',
          isSystemRole: false,
          createdAt: 1700000000000,
        },
      ],
      devices: [],
      sessions: [
        {
          id: 's-1',
          userId: 'u-1',
          userName: 'Manager',
          userUsername: 'manager',
          deviceId: 'd-1',
          deviceName: 'POS 1',
          sessionKind: 'EMPLOYEE',
          status: 'ACTIVE',
          createdAt: 1700000000000,
          lastSeenAt: 1700000000000,
          expiresAt: 1700100000000,
          idleExpiresAt: 1700050000000,
          isOnline: true,
        },
      ],
      stats: {
        totalAreas: 2,
        totalTables: 10,
        openTables: 3,
        totalProducts: 25,
        totalOrders: 100,
        openOrders: 3,
        paidOrders: 97,
        totalInvoices: 97,
        totalRevenue: 50000000,
        todayInvoices: 81,
      },
      analytics: {
        summary: {
          todayRevenue: 12450000,
          last7DaysRevenue: 70000000,
          last30DaysRevenue: 250000000,
          avgInvoiceValue: 153000,
          completionRate: 98,
          activeDevices: 1,
          activeMembers: 1,
        },
        revenueTrend: [],
        paymentMethods: [],
        hourlyDistribution: [],
        topProducts: [],
      },
    };

    const msg = buildStoreDetailMessage(mockDetail);
    expect(msg.text).toContain('🏪 Coffee ABC');
    expect(msg.text).toContain('🟢 Hoạt động (ACTIVE)');
    expect(msg.text).toContain('Bàn bida: 10 bàn');
    expect(msg.text).toContain('Doanh thu hôm nay: 12.450.000 ₫');
    expect(msg.text).toContain('Hóa đơn hôm nay: 81 HĐ');
    expect(msg.text).toContain('Nhân sự: 1 nhân viên');
    expect(msg.text).toContain('1 active');

    const flatButtons = msg.replyMarkup.inline_keyboard.flat();
    expect(
      flatButtons.some(
        (b) => b.callback_data === 'store:refresh:11111111-2222-3333-4444-555555555555',
      ),
    ).toBe(true);
    expect(
      flatButtons.some(
        (b) => b.callback_data === 'store:analytics:11111111-2222-3333-4444-555555555555',
      ),
    ).toBe(true);
    expect(
      flatButtons.some(
        (b) => b.callback_data === 'store:devices:11111111-2222-3333-4444-555555555555',
      ),
    ).toBe(true);
    expect(
      flatButtons.some(
        (b) => b.callback_data === 'store:staff:11111111-2222-3333-4444-555555555555',
      ),
    ).toBe(true);
    expect(
      flatButtons.some(
        (b) => b.callback_data === 'store:settings:11111111-2222-3333-4444-555555555555',
      ),
    ).toBe(true);
    expect(flatButtons.some((b) => b.callback_data === 'menu:stores')).toBe(true);
    expect(flatButtons.some((b) => b.callback_data === 'menu:home')).toBe(true);

    for (const b of flatButtons) {
      if (b.callback_data) {
        expect(new TextEncoder().encode(b.callback_data).length).toBeLessThanOrEqual(64);
      }
    }
  });

  it('builds Store Analytics view with top products and payment methods', () => {
    const mockDetail: PlatformStoreDetail = {
      store: {
        id: '11111111-2222-3333-4444-555555555555',
        name: 'Coffee ABC',
        status: 'ACTIVE',
        timezone: 'Asia/Ho_Chi_Minh',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        posRealtimeEnabled: true,
        settings: null,
      },
      members: [],
      devices: [],
      sessions: [],
      stats: {
        totalAreas: 2,
        totalTables: 10,
        openTables: 2,
        totalProducts: 20,
        totalOrders: 50,
        openOrders: 2,
        paidOrders: 48,
        totalInvoices: 48,
        totalRevenue: 25000000,
        todayInvoices: 10,
        dineInOrders: 40,
        takeawayOrders: 10,
        cancelledOrders: 1,
        cancelRate: 2,
        totalDiscountAmount: 150000,
      },
      analytics: {
        summary: {
          todayRevenue: 5000000,
          last7DaysRevenue: 20000000,
          last30DaysRevenue: 25000000,
          avgInvoiceValue: 250000,
          completionRate: 98,
          activeDevices: 1,
          activeMembers: 2,
        },
        revenueTrend: [],
        paymentMethods: [
          { method: 'CASH', label: 'Tiền mặt', count: 30, totalAmount: 15000000, percentage: 60 },
          {
            method: 'BANK_TRANSFER',
            label: 'Chuyển khoản QR',
            count: 18,
            totalAmount: 10000000,
            percentage: 40,
          },
        ],
        hourlyDistribution: [],
        topProducts: [
          { name: 'Cà phê sữa đá', productType: 'DRINK', totalQuantity: 45, totalRevenue: 1125000 },
          { name: 'Trà đào cam sả', productType: 'DRINK', totalQuantity: 30, totalRevenue: 900000 },
        ],
      },
    };

    const msg = buildStoreAnalyticsMessage(mockDetail);
    expect(msg.text).toContain('📊 PRO POS — Doanh thu & Phân tích');
    expect(msg.text).toContain('Coffee ABC');
    expect(msg.text).toContain('Doanh thu hôm nay: 5.000.000 ₫');
    expect(msg.text).toContain('Đơn tại bàn: 40 | Mang về: 10');
    expect(msg.text).toContain('Tổng giảm giá đã cấp: 150.000 ₫');
    expect(msg.text).toContain('💵 Tiền mặt: 15.000.000 ₫ (30 GD)');
    expect(msg.text).toContain('📲 Chuyển khoản QR: 10.000.000 ₫ (18 GD)');
    expect(msg.text).toContain('Cà phê sữa đá');
    expect(msg.text).toContain('45 phần · 1.125.000 ₫');

    const flatButtons = msg.replyMarkup.inline_keyboard.flat();
    expect(
      flatButtons.some(
        (b) => b.callback_data === 'store:analytics:11111111-2222-3333-4444-555555555555',
      ),
    ).toBe(true);
    expect(
      flatButtons.some(
        (b) => b.callback_data === 'store:view:11111111-2222-3333-4444-555555555555',
      ),
    ).toBe(true);

    for (const b of flatButtons) {
      if (b.callback_data) {
        expect(new TextEncoder().encode(b.callback_data).length).toBeLessThanOrEqual(64);
      }
    }
  });

  it('builds Store Devices view with online/offline breakdown and session info', () => {
    const mockDetail: PlatformStoreDetail = {
      store: {
        id: '11111111-2222-3333-4444-555555555555',
        name: 'Coffee ABC',
        status: 'ACTIVE',
        timezone: 'Asia/Ho_Chi_Minh',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        posRealtimeEnabled: true,
        settings: null,
      },
      members: [],
      devices: [
        {
          id: 'dev-1',
          name: 'POS Quầy 1',
          status: 'ACTIVE',
          activatedBy: 'u-1',
          activatedByName: 'Quản Lý Quán',
          activatedAt: 1700000000000,
          revokedAt: null,
          lastSeenAt: 1700000000000,
          createdAt: 1700000000000,
          isOnline: true,
          pushNotificationEnabled: true,
          currentSession: {
            id: 's-1',
            userId: 'u-2',
            userName: 'Ngọc Vân',
            userUsername: 'ngocvan',
            userRoleName: 'Thu ngân',
            createdAt: 1700000000000,
            lastSeenAt: 1700000000000,
            isOnline: true,
          },
        },
        {
          id: 'dev-2',
          name: 'Máy Order Bàn',
          status: 'ACTIVE',
          activatedBy: 'u-1',
          activatedByName: 'Quản Lý Quán',
          activatedAt: 1700000000000,
          revokedAt: null,
          lastSeenAt: 1699900000000,
          createdAt: 1700000000000,
          isOnline: false,
          pushNotificationEnabled: false,
          currentSession: null,
        },
      ],
      sessions: [],
      stats: {
        totalAreas: 1,
        totalTables: 5,
        openTables: 0,
        totalProducts: 10,
        totalOrders: 0,
        openOrders: 0,
        paidOrders: 0,
        totalInvoices: 0,
        totalRevenue: 0,
      },
      analytics: {
        summary: {
          todayRevenue: 0,
          last7DaysRevenue: 0,
          last30DaysRevenue: 0,
          avgInvoiceValue: 0,
          completionRate: 100,
          activeDevices: 1,
          activeMembers: 1,
        },
        revenueTrend: [],
        paymentMethods: [],
        hourlyDistribution: [],
        topProducts: [],
      },
    };

    const msg = buildStoreDevicesMessage(mockDetail);
    expect(msg.text).toContain('💻 PRO POS — Thiết bị POS');
    expect(msg.text).toContain('Tổng thiết bị: 2 máy');
    expect(msg.text).toContain('🟢 Online: 1 | ⚪ Offline: 1');
    expect(msg.text).toContain('POS Quầy 1');
    expect(msg.text).toContain('Ngọc Vân (Thu ngân)');
    expect(msg.text).toContain('Push notify: Bật');
    expect(msg.text).toContain('Máy Order Bàn');

    const flatButtons = msg.replyMarkup.inline_keyboard.flat();
    expect(
      flatButtons.some(
        (b) => b.callback_data === 'store:devices:11111111-2222-3333-4444-555555555555',
      ),
    ).toBe(true);
    expect(
      flatButtons.some(
        (b) => b.callback_data === 'store:view:11111111-2222-3333-4444-555555555555',
      ),
    ).toBe(true);

    for (const b of flatButtons) {
      if (b.callback_data) {
        expect(new TextEncoder().encode(b.callback_data).length).toBeLessThanOrEqual(64);
      }
    }
  });

  it('builds Store Staff view with member roles and status', () => {
    const mockDetail: PlatformStoreDetail = {
      store: {
        id: '11111111-2222-3333-4444-555555555555',
        name: 'Coffee ABC',
        status: 'ACTIVE',
        timezone: 'Asia/Ho_Chi_Minh',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        posRealtimeEnabled: true,
        settings: null,
      },
      members: [
        {
          id: 'm-1',
          userId: 'u-1',
          username: 'owner_van',
          displayName: 'Văn Đặng',
          email: 'van@propos.vn',
          phone: '0901234567',
          userStatus: 'ACTIVE',
          membershipStatus: 'ACTIVE',
          roleCode: 'OWNER',
          roleName: 'Chủ sở hữu',
          isSystemRole: true,
          createdAt: 1700000000000,
        },
      ],
      devices: [],
      sessions: [],
      stats: {
        totalAreas: 1,
        totalTables: 5,
        openTables: 0,
        totalProducts: 10,
        totalOrders: 0,
        openOrders: 0,
        paidOrders: 0,
        totalInvoices: 0,
        totalRevenue: 0,
      },
      analytics: {
        summary: {
          todayRevenue: 0,
          last7DaysRevenue: 0,
          last30DaysRevenue: 0,
          avgInvoiceValue: 0,
          completionRate: 100,
          activeDevices: 0,
          activeMembers: 1,
        },
        revenueTrend: [],
        paymentMethods: [],
        hourlyDistribution: [],
        topProducts: [],
      },
    };

    const msg = buildStoreStaffMessage(mockDetail);
    expect(msg.text).toContain('👥 PRO POS — Đội ngũ Nhân sự');
    expect(msg.text).toContain('Tổng nhân sự: 1 người (1 đang hoạt động)');
    expect(msg.text).toContain('Văn Đặng (@owner_van)');
    expect(msg.text).toContain('Chức vụ: Chủ sở hữu');
    expect(msg.text).toContain('SĐT: 0901234567');
    expect(msg.text).toContain('Email: van@propos.vn');

    const flatButtons = msg.replyMarkup.inline_keyboard.flat();
    expect(
      flatButtons.some(
        (b) => b.callback_data === 'store:staff:11111111-2222-3333-4444-555555555555',
      ),
    ).toBe(true);

    for (const b of flatButtons) {
      if (b.callback_data) {
        expect(new TextEncoder().encode(b.callback_data).length).toBeLessThanOrEqual(64);
      }
    }
  });

  it('builds Store Settings view with location, config and bank info', () => {
    const mockDetail: PlatformStoreDetail = {
      store: {
        id: '11111111-2222-3333-4444-555555555555',
        name: 'Coffee ABC',
        status: 'ACTIVE',
        timezone: 'Asia/Ho_Chi_Minh',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        posRealtimeEnabled: true,
        settings: {
          currency: 'VND',
          businessDayCutoffMinutes: 60,
          phone: '0901234567',
          address: '123 Lê Lợi',
          provinceCode: 79,
          provinceName: 'TP. Hồ Chí Minh',
          wardCode: 1,
          wardName: 'Bến Nghé',
          bankName: 'Vietcombank',
          bankAccountNumber: '999888777666',
          bankAccountName: 'DANG NGOC VAN',
          bankQrMediaId: 'media-qr-123',
        },
      },
      members: [],
      devices: [],
      sessions: [],
      stats: {
        totalAreas: 3,
        totalTables: 15,
        openTables: 2,
        totalProducts: 30,
        totalOrders: 10,
        openOrders: 1,
        paidOrders: 9,
        totalInvoices: 9,
        totalRevenue: 1000000,
        totalCategories: 4,
        lastActivityAt: 1700005000000,
      },
      analytics: {
        summary: {
          todayRevenue: 1000000,
          last7DaysRevenue: 1000000,
          last30DaysRevenue: 1000000,
          avgInvoiceValue: 111111,
          completionRate: 100,
          activeDevices: 1,
          activeMembers: 1,
        },
        revenueTrend: [],
        paymentMethods: [],
        hourlyDistribution: [],
        topProducts: [],
      },
    };

    const msg = buildStoreSettingsMessage(mockDetail);
    expect(msg.text).toContain('⚙️ PRO POS — Cấu hình & Thông tin');
    expect(msg.text).toContain('Hotline: 0901234567');
    expect(msg.text).toContain('123 Lê Lợi, Bến Nghé, TP. Hồ Chí Minh');
    expect(msg.text).toContain('POS Realtime: 🟢 Đang bật (Đồng bộ tức thì)');
    expect(msg.text).toContain('+60 phút');
    expect(msg.text).toContain('Vietcombank');
    expect(msg.text).toContain('999888777666');
    expect(msg.text).toContain('DANG NGOC VAN');
    expect(msg.text).toContain('Mã QR thanh toán: 🟢 Đã cấu hình');

    const flatButtons = msg.replyMarkup.inline_keyboard.flat();
    expect(
      flatButtons.some(
        (b) => b.callback_data === 'store:settings:11111111-2222-3333-4444-555555555555',
      ),
    ).toBe(true);

    for (const b of flatButtons) {
      if (b.callback_data) {
        expect(new TextEncoder().encode(b.callback_data).length).toBeLessThanOrEqual(64);
      }
    }
  });

  it('builds Version and Help screens correctly', () => {
    const versionMsg = buildVersionMessage({
      ENVIRONMENT: 'production',
      APP_VERSION: '0.1.0',
      BUILD_SHA: 'abcdef1',
      BUILD_TIME: '08/09/2026 09:10',
    });

    expect(versionMsg.text).toContain('Environment:\nproduction');
    expect(versionMsg.text).toContain('Version:\n0.1.0');
    expect(versionMsg.text).toContain('Commit:\nabcdef1');
    expect(versionMsg.text).toContain('Built:\n08/09/2026 09:10');

    const helpMsg = buildHelpMessage();
    expect(helpMsg.text).toContain('❓ PRO POS Admin Bot');
    expect(helpMsg.text).toContain('/start');
    expect(helpMsg.text).toContain('/menu');
    expect(helpMsg.text).toContain('/status');
    expect(helpMsg.text).toContain('/db');
    expect(helpMsg.text).toContain('/stores');
    expect(helpMsg.text).toContain('/version');
    expect(helpMsg.text).toContain('/help');
  });
});
