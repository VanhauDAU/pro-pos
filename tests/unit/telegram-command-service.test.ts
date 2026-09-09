import { describe, expect, it, vi } from 'vitest';

import { TelegramCommandService } from '@server/integrations/telegram/telegram-command-service';
import type { TelegramClient } from '@server/integrations/telegram/telegram-client';
import type { TelegramAuthorizedAdmin } from '@server/integrations/telegram/telegram-types';

describe('TelegramCommandService Unit Tests', () => {
  const mockEnv = {
    DB: {} as D1Database,
    TELEGRAM_BOT_TOKEN: 'mock-token',
    TELEGRAM_BOT_USERNAME: 'Proposbida_bot',
    ENVIRONMENT: 'local',
  } as unknown as CloudflareBindings;

  it('filters out non-private messages', async () => {
    const mockClient = {
      sendMessage: vi.fn(),
      editMessageText: vi.fn(),
      answerCallbackQuery: vi.fn(),
    } as unknown as TelegramClient;

    const service = new TelegramCommandService(mockEnv, mockClient);

    await service.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: 1700000000,
        chat: { id: -100, type: 'group' },
        from: { id: 123, is_bot: false, first_name: 'GroupUser' },
        text: '/status',
      },
    });

    expect(mockClient.sendMessage).not.toHaveBeenCalled();
  });

  it('rejects unauthorized users with unauthorized message', async () => {
    const mockClient = {
      sendMessage: vi.fn(),
      editMessageText: vi.fn(),
      answerCallbackQuery: vi.fn(),
    } as unknown as TelegramClient;

    const service = new TelegramCommandService(mockEnv, mockClient);
    vi.spyOn(service, 'authorize').mockResolvedValue(null);

    await service.handleUpdate({
      update_id: 2,
      message: {
        message_id: 2,
        date: 1700000000,
        chat: { id: 123, type: 'private' },
        from: { id: 123, is_bot: false, first_name: 'UnauthorizedUser' },
        text: '/status',
      },
    });

    expect(mockClient.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 123,
        text: expect.stringContaining('Bạn không có quyền'),
      }),
    );
  });

  it('strips @botusername suffix from commands and dispatches correctly', async () => {
    const mockClient = {
      sendMessage: vi.fn(),
      editMessageText: vi.fn(),
      answerCallbackQuery: vi.fn(),
    } as unknown as TelegramClient;

    const service = new TelegramCommandService(mockEnv, mockClient);
    const mockAdmin: TelegramAuthorizedAdmin = {
      link: {
        id: 'l-1',
        userId: 'u-1',
        telegramUserId: '123',
        telegramUsername: 'admin',
        telegramFirstName: 'Admin',
        telegramLastName: null,
        telegramChatId: '123',
        linkedAt: 1700000000,
        updatedAt: 1700000000,
      },
      user: {
        id: 'u-1',
        displayName: 'Super Admin',
        username: 'superadmin',
        email: 'admin@example.com',
        status: 'ACTIVE',
        platformRole: 'SUPER_ADMIN',
      },
    };

    vi.spyOn(service, 'authorize').mockResolvedValue(mockAdmin);

    await service.handleUpdate({
      update_id: 3,
      message: {
        message_id: 3,
        date: 1700000000,
        chat: { id: 123, type: 'private' },
        from: { id: 123, is_bot: false, first_name: 'Admin' },
        text: '/version@Proposbida_bot',
      },
    });

    expect(mockClient.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 123,
        text: expect.stringContaining('🚀 PRO POS'),
      }),
    );
  });

  it('supports pairing with direct 8-character code or /start@botname', async () => {
    const mockClient = {
      sendMessage: vi.fn(),
      editMessageText: vi.fn(),
      answerCallbackQuery: vi.fn(),
    } as unknown as TelegramClient;

    const service = new TelegramCommandService(mockEnv, mockClient);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn((service as any).linkService, 'pairWithCode').mockResolvedValue({
      success: true,
      displayName: 'Super Admin',
    });

    await service.handleUpdate({
      update_id: 4,
      message: {
        message_id: 4,
        date: 1700000000,
        chat: { id: 123, type: 'private' },
        from: { id: 123, is_bot: false, first_name: 'Admin' },
        text: 'ABC12345',
      },
    });

    expect(mockClient.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 123,
        text: expect.stringContaining('Kết nối thành công'),
      }),
    );
  });

  it('routes store sub-view callbacks (analytics, devices, staff, settings) to editMessageText', async () => {
    const mockClient = {
      sendMessage: vi.fn(),
      editMessageText: vi.fn(),
      answerCallbackQuery: vi.fn(),
    } as unknown as TelegramClient;

    const service = new TelegramCommandService(mockEnv, mockClient);
    const mockAdmin: TelegramAuthorizedAdmin = {
      link: {
        id: 'l-1',
        userId: 'u-1',
        telegramUserId: '123',
        telegramUsername: 'admin',
        telegramFirstName: 'Admin',
        telegramLastName: null,
        telegramChatId: '123',
        linkedAt: 1700000000,
        updatedAt: 1700000000,
      },
      user: {
        id: 'u-1',
        displayName: 'Super Admin',
        username: 'superadmin',
        email: 'admin@example.com',
        status: 'ACTIVE',
        platformRole: 'SUPER_ADMIN',
      },
    };

    vi.spyOn(service, 'authorize').mockResolvedValue(mockAdmin);
    const storeId = '11111111-2222-3333-4444-555555555555';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn((service as any).platformService, 'getStoreDetails').mockResolvedValue({
      store: {
        id: storeId,
        name: 'Billiards Đại',
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
        openTables: 0,
        totalProducts: 20,
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
          activeMembers: 0,
        },
        revenueTrend: [],
        paymentMethods: [],
        hourlyDistribution: [],
        topProducts: [],
      },
    });

    const actions = ['analytics', 'devices', 'staff', 'settings', 'view'];
    for (const act of actions) {
      await service.handleUpdate({
        update_id: 10,
        callback_query: {
          id: `cb-${act}`,
          from: { id: 123, is_bot: false, first_name: 'Admin' },
          message: {
            message_id: 99,
            date: 1700000000,
            chat: { id: 123, type: 'private' },
            text: 'Original message',
          },
          data: `store:${act}:${storeId}`,
        },
      });

      expect(mockClient.answerCallbackQuery).toHaveBeenCalledWith({ callbackQueryId: `cb-${act}` });
      expect(mockClient.editMessageText).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: 123,
          messageId: 99,
          text: expect.any(String),
        }),
      );
    }
  });
});
