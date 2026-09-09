import type {
  CreateTelegramLinkCodeResponse,
  TelegramAdminLinkStatusResponse,
} from '@contracts/platform';
import { hashExchangeCode, randomOpaqueToken } from '@server/lib/crypto';
import type { TelegramUser } from '../integrations/telegram/telegram-types';
import { TelegramRepository } from '../repositories/telegram-repository';

export class TelegramLinkService {
  private readonly repository: TelegramRepository;
  private readonly botUsername: string;

  constructor(private readonly env: CloudflareBindings) {
    this.repository = new TelegramRepository(env.DB);
    this.botUsername = env.TELEGRAM_BOT_USERNAME || 'Proposbida_bot';
  }

  async getStatus(userId: string): Promise<TelegramAdminLinkStatusResponse> {
    const link = await this.repository.getLinkByUserId(userId);
    if (!link) {
      return {
        linked: false,
        botUsername: this.botUsername,
        link: null,
      };
    }
    return {
      linked: true,
      botUsername: this.botUsername,
      link: {
        id: link.id,
        telegramUserId: link.telegramUserId,
        telegramUsername: link.telegramUsername,
        telegramFirstName: link.telegramFirstName,
        telegramLastName: link.telegramLastName,
        linkedAt: link.linkedAt,
      },
    };
  }

  async createLinkCode(userId: string): Promise<CreateTelegramLinkCodeResponse> {
    const now = Date.now();
    // Generate a clean 8-character uppercase alphanumeric pairing code
    const rawToken = randomOpaqueToken(12);
    const code = rawToken
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 8)
      .toUpperCase();
    const codeHash = await hashExchangeCode(code);
    const id = crypto.randomUUID();
    const expiresAt = now + 15 * 60 * 1000; // 15 minutes

    await this.repository.createLinkCode({
      id,
      userId,
      codeHash,
      expiresAt,
      now,
    });

    const deepLink = `https://t.me/${this.botUsername}?start=${code}`;

    return {
      code,
      expiresAt,
      botUsername: this.botUsername,
      deepLink,
    };
  }

  async unlink(userId: string): Promise<{ success: boolean; unlinkedCount: number }> {
    const unlinkedCount = await this.repository.deleteLinkByUserId(userId);
    return { success: true, unlinkedCount };
  }

  async pairWithCode(input: {
    code: string;
    telegramUser: TelegramUser;
    chatId?: string;
  }): Promise<
    | { success: true; displayName: string }
    | { success: false; reason: 'INVALID_OR_EXPIRED' | 'NOT_SUPER_ADMIN' }
  > {
    const now = Date.now();
    const codeHash = await hashExchangeCode(input.code.trim().toUpperCase());
    const validCode = await this.repository.findValidLinkCode(codeHash, now);

    if (!validCode) {
      return { success: false, reason: 'INVALID_OR_EXPIRED' };
    }

    if (validCode.userStatus !== 'ACTIVE' || validCode.platformRole !== 'SUPER_ADMIN') {
      return { success: false, reason: 'NOT_SUPER_ADMIN' };
    }

    const consumed = await this.repository.consumeLinkCode(validCode.codeId, now);
    if (!consumed) {
      return { success: false, reason: 'INVALID_OR_EXPIRED' };
    }

    const linkId = crypto.randomUUID();
    await this.repository.upsertLink({
      id: linkId,
      userId: validCode.userId,
      telegramUserId: String(input.telegramUser.id),
      telegramUsername: input.telegramUser.username ?? null,
      telegramFirstName: input.telegramUser.first_name ?? null,
      telegramLastName: input.telegramUser.last_name ?? null,
      telegramChatId: input.chatId ? String(input.chatId) : null,
      now,
    });

    return { success: true, displayName: validCode.displayName };
  }
}
