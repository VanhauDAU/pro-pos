import type { PlatformStoreSummary } from '@contracts/platform';
import { MaintenanceService } from '@server/services/maintenance-service';
import { PlatformService } from '@server/services/platform-service';
import { TelegramRepository } from '@server/repositories/telegram-repository';
import { TelegramLinkService } from '@server/services/telegram-link-service';
import { TelegramClient } from './telegram-client';
import {
  buildDatabaseMessage,
  buildDatabaseTopMessage,
  buildErrorMessage,
  buildHelpMessage,
  buildHomeMessage,
  buildPairingSuccessMessage,
  buildStatusMessage,
  buildStoreAnalyticsMessage,
  buildStoreDetailMessage,
  buildStoreDevicesMessage,
  buildStoreSettingsMessage,
  buildStoreStaffMessage,
  buildStoresMessage,
  buildUnauthorizedMessage,
  buildUnlinkedStartMessage,
  buildVersionMessage,
} from './telegram-message-builder';
import type {
  TelegramAuthorizedAdmin,
  TelegramCallbackQuery,
  TelegramMessage,
  TelegramUpdate,
} from './telegram-types';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DB_REFRESH_COOLDOWN_MS = 10_000;

export class TelegramCommandService {
  private readonly client: TelegramClient;
  private readonly repository: TelegramRepository;
  private readonly linkService: TelegramLinkService;
  private readonly maintenanceService: MaintenanceService;
  private readonly platformService: PlatformService;
  private readonly botUsername: string;
  private readonly adminWebUrl: string | undefined;

  // In-memory cooldown tracking per Telegram user ID
  private static readonly dbRefreshCooldowns = new Map<string, number>();

  constructor(
    private readonly env: CloudflareBindings,
    client?: TelegramClient,
  ) {
    this.client =
      client ??
      (env.TELEGRAM_BOT_TOKEN
        ? new TelegramClient(env.TELEGRAM_BOT_TOKEN)
        : (null as unknown as TelegramClient));
    this.repository = new TelegramRepository(env.DB);
    this.linkService = new TelegramLinkService(env);
    this.maintenanceService = new MaintenanceService(env);
    this.platformService = new PlatformService(env);
    this.botUsername = env.TELEGRAM_BOT_USERNAME || 'Proposbida_bot';
    this.adminWebUrl = env.ACCESS_BRIDGE_URL || undefined;
  }

  async authorize(telegramUserId: number | string): Promise<TelegramAuthorizedAdmin | null> {
    const authorized = await this.repository.findAuthorizedAdmin(String(telegramUserId));
    if (!authorized) return null;
    if (authorized.user.status !== 'ACTIVE' || authorized.user.platformRole !== 'SUPER_ADMIN') {
      return null;
    }
    return authorized;
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.message) {
      await this.handleMessage(update.message);
    } else if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
    }
  }

  private async handleMessage(message: TelegramMessage): Promise<void> {
    // Only accept private chats for admin bot
    if (!message.chat || message.chat.type !== 'private') {
      return;
    }

    const sender = message.from;
    if (!sender) return;

    const chatId = message.chat.id;
    const text = message.text?.trim() ?? '';
    const parts = text.split(/\s+/);
    const rawCommand = (parts[0] || '').toLowerCase();
    const command = rawCommand.replace(new RegExp(`@${this.botUsername}$`, 'i'), '');
    const commandArg = parts[1];
    const isPairingCode = /^[A-Za-z0-9]{8}$/.test(text);

    // Handle /start (with or without pairing code) OR direct 8-character pairing code
    if (command === '/start' || isPairingCode) {
      const codeToPair = isPairingCode ? text : commandArg;
      if (codeToPair) {
        // Pairing flow
        const result = await this.linkService.pairWithCode({
          code: codeToPair,
          telegramUser: sender,
          chatId: String(chatId),
        });

        if (result.success) {
          await this.client.sendMessage({
            chatId,
            ...buildPairingSuccessMessage(result.displayName),
          });
          await this.client.sendMessage({
            chatId,
            ...buildHomeMessage(result.displayName),
          });
          return;
        }

        await this.client.sendMessage({
          chatId,
          text: '⚠️ Mã kết nối không hợp lệ hoặc đã hết hạn. Vui lòng tạo mã mới từ trang Quản trị viên (SUPER_ADMIN) trên Web.',
        });
        return;
      }

      // /start without code: check if already linked
      const auth = await this.authorize(sender.id);
      if (auth) {
        await this.client.sendMessage({
          chatId,
          ...buildHomeMessage(auth.user.displayName),
        });
      } else {
        await this.client.sendMessage({
          chatId,
          ...buildUnlinkedStartMessage(this.botUsername),
        });
      }
      return;
    }

    // All other commands require authorization
    const auth = await this.authorize(sender.id);
    if (!auth) {
      await this.client.sendMessage({
        chatId,
        ...buildUnauthorizedMessage(),
      });
      return;
    }

    const cleanCommand = command;

    switch (cleanCommand) {
      case '/menu':
      case '/home': {
        await this.client.sendMessage({
          chatId,
          ...buildHomeMessage(auth.user.displayName),
        });
        break;
      }
      case '/status': {
        const msg = await this.getStatusMessage();
        await this.client.sendMessage({ chatId, ...msg });
        break;
      }
      case '/db': {
        const msg = await this.getDatabaseMessage();
        await this.client.sendMessage({ chatId, ...msg });
        break;
      }
      case '/stores': {
        const msg = await this.getStoresMessage(1);
        await this.client.sendMessage({ chatId, ...msg });
        break;
      }
      case '/version': {
        await this.client.sendMessage({
          chatId,
          ...buildVersionMessage(this.env),
        });
        break;
      }
      case '/help': {
        await this.client.sendMessage({
          chatId,
          ...buildHelpMessage(),
        });
        break;
      }
      default: {
        // Unknown text or command: provide help message
        await this.client.sendMessage({
          chatId,
          ...buildHelpMessage(),
        });
        break;
      }
    }
  }

  private async handleCallbackQuery(query: TelegramCallbackQuery): Promise<void> {
    const queryId = query.id;
    const sender = query.from;
    const data = query.data ?? '';

    // Validate chat is private
    const chat = query.message?.chat;
    if (chat && chat.type !== 'private') {
      await this.client.answerCallbackQuery({
        callbackQueryId: queryId,
        text: 'Chỉ hỗ trợ trong cuộc trò chuyện riêng tư.',
        showAlert: true,
      });
      return;
    }

    // Always answer callback query promptly to dismiss Telegram loading spinner
    // First authorize
    const auth = await this.authorize(sender.id);
    if (!auth) {
      await this.client.answerCallbackQuery({
        callbackQueryId: queryId,
        text: '⛔ Bạn không có quyền sử dụng bot quản trị PRO POS.',
        showAlert: true,
      });
      return;
    }

    // Validate callback_data length & format
    if (data.length === 0 || data.length > 64) {
      await this.client.answerCallbackQuery({
        callbackQueryId: queryId,
        text: 'Thao tác không hợp lệ.',
        showAlert: false,
      });
      return;
    }

    const messageId = query.message?.message_id;
    const chatId = query.message?.chat.id;

    if (!messageId || !chatId) {
      await this.client.answerCallbackQuery({
        callbackQueryId: queryId,
        text: 'Không tìm thấy tin nhắn cần cập nhật.',
      });
      return;
    }

    // Fast acknowledge callback query to keep Telegram UI responsive
    await this.client.answerCallbackQuery({ callbackQueryId: queryId });

    try {
      await this.routeCallback(data, chatId, messageId, auth, queryId);
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          message: 'failed to process telegram callback',
          data,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      await this.client.editMessageText({
        chatId,
        messageId,
        ...buildErrorMessage(),
      });
    }
  }

  private async routeCallback(
    data: string,
    chatId: number | string,
    messageId: number,
    auth: TelegramAuthorizedAdmin,
    queryId: string,
  ): Promise<void> {
    const segments = data.split(':');
    const domain = segments[0];
    const action = segments[1];
    const param = segments[2];

    if (domain === 'menu') {
      switch (action) {
        case 'home': {
          await this.client.editMessageText({
            chatId,
            messageId,
            ...buildHomeMessage(auth.user.displayName),
          });
          return;
        }
        case 'status': {
          const msg = await this.getStatusMessage();
          await this.client.editMessageText({ chatId, messageId, ...msg });
          return;
        }
        case 'db': {
          const msg = await this.getDatabaseMessage();
          await this.client.editMessageText({ chatId, messageId, ...msg });
          return;
        }
        case 'stores': {
          const msg = await this.getStoresMessage(1);
          await this.client.editMessageText({ chatId, messageId, ...msg });
          return;
        }
        case 'version': {
          await this.client.editMessageText({
            chatId,
            messageId,
            ...buildVersionMessage(this.env),
          });
          return;
        }
        case 'help': {
          await this.client.editMessageText({
            chatId,
            messageId,
            ...buildHelpMessage(),
          });
          return;
        }
      }
    }

    if (domain === 'status' && action === 'refresh') {
      const msg = await this.getStatusMessage();
      await this.client.editMessageText({ chatId, messageId, ...msg });
      return;
    }

    if (domain === 'db') {
      if (action === 'refresh') {
        const userKey = auth.link.telegramUserId;
        const lastRefresh = TelegramCommandService.dbRefreshCooldowns.get(userKey) ?? 0;
        const now = Date.now();

        if (now - lastRefresh < DB_REFRESH_COOLDOWN_MS) {
          // Cooldown active, gentle toast
          await this.client.answerCallbackQuery({
            callbackQueryId: queryId,
            text: 'Dữ liệu vừa được phân tích. Vui lòng thử lại sau vài giây.',
            showAlert: false,
          });
          return;
        }

        TelegramCommandService.dbRefreshCooldowns.set(userKey, now);
        const msg = await this.getDatabaseMessage();
        await this.client.editMessageText({ chatId, messageId, ...msg });
        return;
      }

      if (action === 'top') {
        const msg = await this.getDatabaseTopMessage();
        await this.client.editMessageText({ chatId, messageId, ...msg });
        return;
      }
    }

    if (domain === 'stores') {
      if (action === 'refresh' || action === 'list') {
        const msg = await this.getStoresMessage(1);
        await this.client.editMessageText({ chatId, messageId, ...msg });
        return;
      }

      if (action === 'page' && param) {
        const pageNum = parseInt(param, 10) || 1;
        const msg = await this.getStoresMessage(pageNum);
        await this.client.editMessageText({ chatId, messageId, ...msg });
        return;
      }
    }

    if (domain === 'store') {
      const storeId = param;
      if (!storeId || !UUID_REGEX.test(storeId)) {
        await this.client.answerCallbackQuery({
          callbackQueryId: queryId,
          text: 'Mã cửa hàng không hợp lệ.',
          showAlert: true,
        });
        return;
      }

      try {
        const detail = await this.platformService.getStoreDetails(storeId, 14);
        if (!detail) {
          await this.client.answerCallbackQuery({
            callbackQueryId: queryId,
            text: 'Không tìm thấy cửa hàng.',
            showAlert: true,
          });
          return;
        }

        switch (action) {
          case 'view':
          case 'refresh': {
            await this.client.editMessageText({
              chatId,
              messageId,
              ...buildStoreDetailMessage(detail),
            });
            return;
          }
          case 'analytics': {
            await this.client.editMessageText({
              chatId,
              messageId,
              ...buildStoreAnalyticsMessage(detail),
            });
            return;
          }
          case 'devices': {
            await this.client.editMessageText({
              chatId,
              messageId,
              ...buildStoreDevicesMessage(detail),
            });
            return;
          }
          case 'staff': {
            await this.client.editMessageText({
              chatId,
              messageId,
              ...buildStoreStaffMessage(detail),
            });
            return;
          }
          case 'settings': {
            await this.client.editMessageText({
              chatId,
              messageId,
              ...buildStoreSettingsMessage(detail),
            });
            return;
          }
        }
      } catch {
        await this.client.answerCallbackQuery({
          callbackQueryId: queryId,
          text: 'Không tìm thấy cửa hàng.',
          showAlert: true,
        });
        return;
      }
    }

    // Default unknown callback
    await this.client.answerCallbackQuery({
      callbackQueryId: queryId,
      text: 'Thao tác không còn hợp lệ.',
      showAlert: false,
    });
  }

  private async getStatusMessage() {
    const [metrics, dbReport] = await Promise.all([
      this.repository.getSystemMetrics(),
      this.maintenanceService.getStorageReport().catch(() => null),
    ]);

    return buildStatusMessage({
      environment: this.env.ENVIRONMENT || 'production',
      activeStoresCount: metrics.activeStoresCount,
      lockedStoresCount: metrics.lockedStoresCount,
      databaseSizeBytes: dbReport?.databaseSizeBytes ?? dbReport?.totalEstimatedDataBytes ?? null,
      realtimePendingCount: metrics.realtimePendingCount,
      abnormalPrintJobsCount: metrics.abnormalPrintJobsCount,
      updatedAt: Date.now(),
    });
  }

  private async getDatabaseMessage() {
    const report = await this.maintenanceService.getStorageReport();
    return buildDatabaseMessage(report, this.adminWebUrl);
  }

  private async getDatabaseTopMessage() {
    const report = await this.maintenanceService.getStorageReport();
    return buildDatabaseTopMessage(report);
  }

  private async getStoresMessage(page = 1) {
    const storesResult = await this.platformService.listStores();
    return buildStoresMessage(storesResult.results as unknown as PlatformStoreSummary[], page);
  }
}
