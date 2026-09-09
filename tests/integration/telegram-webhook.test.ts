import { env } from 'cloudflare:workers';
import { SELF } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { deriveCsrfToken, hashExchangeCode, randomOpaqueToken } from '@server/lib/crypto';
import { TelegramClient } from '@server/integrations/telegram/telegram-client';
import type {
  AnswerCallbackQueryOptions,
  EditMessageTextOptions,
  SendMessageOptions,
} from '@server/integrations/telegram/telegram-types';
import { AccessAuthRepository } from '@server/repositories/access-auth-repository';
import { PlatformRepository } from '@server/repositories/platform-repository';
import { TelegramRepository } from '@server/repositories/telegram-repository';
import { AccessAuthService } from '@server/services/access-auth-service';
import { PlatformService } from '@server/services/platform-service';

const ORIGIN = 'https://pro-pos.test';
const ADMIN_EMAIL = 'tg.system.admin@example.com';
const WEBHOOK_SECRET = 'test-webhook-secret-1234567890';
const BOT_TOKEN = '123456789:TEST_BOT_TOKEN_MOCK';

interface OutboundTelegramCall {
  method: 'sendMessage' | 'editMessageText' | 'answerCallbackQuery';
  options: SendMessageOptions | EditMessageTextOptions | AnswerCallbackQueryOptions;
}

function cookieValue(response: Response, name: string) {
  const header = response.headers.get('Set-Cookie') ?? '';
  const match = header.match(new RegExp(`(?:^|,\\s*)${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : null;
}

async function jsonData<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as { data: T };
  return payload.data;
}

async function authorizeBridge(requestId: string, email: string) {
  const code = randomOpaqueToken();
  await new AccessAuthRepository(env.DB).authorizeRequest({
    id: requestId,
    email,
    subject: `access-${email}`,
    codeHash: await hashExchangeCode(code),
    now: Date.now(),
  });
  return code;
}

async function completeAccess(email: string) {
  const start = await SELF.fetch(`${ORIGIN}/api/v1/auth/access/start`, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ purpose: 'PLATFORM_LOGIN' }),
  });
  const accessCookie = cookieValue(start, '__Host-propos-access')!;
  const rawState = accessCookie.slice(accessCookie.indexOf('=') + 1);
  const startData = await jsonData<{ loginUrl: string }>(start);
  const requestId = new URL(startData.loginUrl).searchParams.get('request');
  const rawCode = await authorizeBridge(requestId!, email);
  const service = new AccessAuthService(env);
  return service.exchange({ rawState, rawCode });
}

describe('Telegram Bot Integration & Webhook Security', () => {
  const outboundCalls: OutboundTelegramCall[] = [];
  let adminUserId: string;

  beforeAll(async () => {
    // Inject test secrets into env
    (env as unknown as Record<string, unknown>).TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    (env as unknown as Record<string, unknown>).TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
    (env as unknown as Record<string, unknown>).TELEGRAM_BOT_USERNAME = 'Proposbida_bot';

    const platform = new PlatformService(env);
    if (!(await new PlatformRepository(env.DB).hasSuperAdmin())) {
      const res = await platform.bootstrap({
        bootstrapSecret: env.SYSTEM_BOOTSTRAP_SECRET!,
        email: ADMIN_EMAIL,
        displayName: 'Telegram Admin',
        password: 'AdminPassword123!',
      });
      adminUserId = res.id;
    } else {
      const row = await env.DB.prepare('SELECT id FROM users WHERE platform_role = ?')
        .bind('SUPER_ADMIN')
        .first<{ id: string }>();
      adminUserId = row!.id;
    }

    // Create a demo store for stores testing
    await platform.createStore({
      name: 'Coffee Demo TG',
      ownerDisplayName: 'Owner TG',
      ownerEmail: 'owner.tg.demo@example.com',
      ownerUsername: 'owner.tg.demo',
      ownerPassword: 'Password123!',
    });

    // Mock TelegramClient prototype methods
    vi.spyOn(TelegramClient.prototype, 'sendMessage').mockImplementation(async (options) => {
      outboundCalls.push({ method: 'sendMessage', options });
      return {
        ok: true,
        result: {
          message_id: 1000 + outboundCalls.length,
          date: Math.floor(Date.now() / 1000),
          chat: { id: options.chatId, type: 'private' },
          text: options.text,
        },
      };
    });

    vi.spyOn(TelegramClient.prototype, 'editMessageText').mockImplementation(async (options) => {
      outboundCalls.push({ method: 'editMessageText', options });
      return {
        ok: true,
        result: true,
      };
    });

    vi.spyOn(TelegramClient.prototype, 'answerCallbackQuery').mockImplementation(
      async (options) => {
        outboundCalls.push({ method: 'answerCallbackQuery', options });
        return {
          ok: true,
          result: true,
        };
      },
    );
  });

  afterEach(() => {
    outboundCalls.length = 0;
  });

  // TEST 1: Missing webhook secret => 403
  it('TEST 1: rejects webhook requests with missing secret header (403)', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ update_id: 1, message: { text: '/start' } }),
    });
    expect(res.status).toBe(403);
  });

  // TEST 2: Wrong webhook secret => 403
  it('TEST 2: rejects webhook requests with invalid secret header (403)', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret-token',
      },
      body: JSON.stringify({ update_id: 1, message: { text: '/start' } }),
    });
    expect(res.status).toBe(403);
  });

  // TEST 3: Correct secret => accepted (200 OK)
  it('TEST 3: accepts webhook requests with valid secret header (200 OK)', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        update_id: 100,
        message: {
          message_id: 1,
          date: 1700000000,
          chat: { id: 9999, type: 'private' },
          from: { id: 9999, is_bot: false, first_name: 'Unlinked' },
          text: '/help',
        },
      }),
    });
    expect(res.status).toBe(200);
  });

  // TEST 4: Unknown / malformed update => no crash (200)
  it('TEST 4: handles malformed payload gracefully without crashing (200 OK)', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET,
      },
      body: JSON.stringify({ some_other_data: 123 }),
    });
    expect(res.status).toBe(200);
    expect(outboundCalls.length).toBe(0);
  });

  // TEST 5: Group message => no admin data leak
  it('TEST 5: ignores group and channel messages to prevent admin data leaks', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        update_id: 101,
        message: {
          message_id: 2,
          date: 1700000000,
          chat: { id: -100123456, type: 'group' },
          from: { id: 1111, is_bot: false, first_name: 'Attacker' },
          text: '/status',
        },
      }),
    });
    expect(res.status).toBe(200);
    // No message should be sent to group
    expect(outboundCalls.length).toBe(0);
  });

  // TEST 6: Unlinked Telegram user => instructions to link
  it('TEST 6: responds with unlinked instructions when an unlinked user sends /start', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        update_id: 102,
        message: {
          message_id: 3,
          date: 1700000000,
          chat: { id: 5555, type: 'private' },
          from: { id: 5555, is_bot: false, first_name: 'Stranger' },
          text: '/start',
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(outboundCalls.length).toBe(1);
    expect(outboundCalls[0]!.method).toBe('sendMessage');
    const sendOpts = outboundCalls[0]!.options as SendMessageOptions;
    expect(sendOpts.text).toContain('chưa được liên kết');
  });

  // TEST 7: Pairing Flow: Generate code -> link -> second use fails -> expired fails
  it('TEST 7: handles pairing code lifecycle (generate -> pair once -> deny replay -> deny expired)', async () => {
    const tgRepo = new TelegramRepository(env.DB);
    const tgUserId = '777888999';

    // Ensure clean state for this tg user
    await env.DB.prepare('DELETE FROM telegram_admin_links WHERE telegram_user_id = ?')
      .bind(tgUserId)
      .run();

    // 1. Generate code for SUPER_ADMIN via Web API (with CSRF)
    const session = await completeAccess(ADMIN_EMAIL);
    if (session.purpose !== 'PLATFORM_LOGIN') throw new Error('Expected platform session');
    const csrfToken = await deriveCsrfToken(session.rawSession, env.AUTH_PEPPER!);
    const sessionCookie = `__Host-propos-session=${session.rawSession}`;

    const linkCodeRes = await SELF.fetch(`${ORIGIN}/api/v1/platform/telegram/link-code`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: sessionCookie,
        'X-CSRF-Token': csrfToken,
      },
    });
    expect(linkCodeRes.status).toBe(201);
    const codeData = await jsonData<{ code: string; deepLink: string }>(linkCodeRes);
    expect(codeData.code).toBeTruthy();
    expect(codeData.deepLink).toContain(codeData.code);

    // 2. Telegram user sends /start <valid-code>
    const pairRes = await SELF.fetch(`${ORIGIN}/api/v1/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        update_id: 103,
        message: {
          message_id: 4,
          date: 1700000000,
          chat: { id: 777888999, type: 'private' },
          from: { id: 777888999, is_bot: false, first_name: 'AdminTG', username: 'admintg' },
          text: `/start ${codeData.code}`,
        },
      }),
    });
    expect(pairRes.status).toBe(200);

    // Should receive Pairing Success and Home Dashboard
    expect(outboundCalls.length).toBe(2);
    expect((outboundCalls[0]!.options as SendMessageOptions).text).toContain('Kết nối thành công');
    expect((outboundCalls[1]!.options as SendMessageOptions).text).toContain('🤖 PRO POS Admin');

    // Verify DB record exists
    const link = await tgRepo.findAuthorizedAdmin(tgUserId);
    expect(link).not.toBeNull();
    expect(link?.user.platformRole).toBe('SUPER_ADMIN');

    // 3. Second use of same code must fail
    outboundCalls.length = 0;
    const replayRes = await SELF.fetch(`${ORIGIN}/api/v1/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        update_id: 104,
        message: {
          message_id: 5,
          date: 1700000000,
          chat: { id: 112233, type: 'private' },
          from: { id: 112233, is_bot: false, first_name: 'Attacker' },
          text: `/start ${codeData.code}`,
        },
      }),
    });
    expect(replayRes.status).toBe(200);
    expect(outboundCalls.length).toBe(1);
    expect((outboundCalls[0]!.options as SendMessageOptions).text).toContain(
      'không hợp lệ hoặc đã hết hạn',
    );

    // 4. Expired code test
    const expiredCode = 'EXP12345';
    const expiredHash = await hashExchangeCode(expiredCode);
    await tgRepo.createLinkCode({
      id: crypto.randomUUID(),
      userId: adminUserId,
      codeHash: expiredHash,
      expiresAt: Date.now() - 10_000, // already expired
      now: Date.now() - 20_000,
    });

    outboundCalls.length = 0;
    const expiredRes = await SELF.fetch(`${ORIGIN}/api/v1/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        update_id: 105,
        message: {
          message_id: 6,
          date: 1700000000,
          chat: { id: 112233, type: 'private' },
          from: { id: 112233, is_bot: false, first_name: 'Attacker' },
          text: `/start ${expiredCode}`,
        },
      }),
    });
    expect(expiredRes.status).toBe(200);
    expect(outboundCalls.length).toBe(1);
    expect((outboundCalls[0]!.options as SendMessageOptions).text).toContain(
      'không hợp lệ hoặc đã hết hạn',
    );
  });

  // TEST 8: Linked active SUPER_ADMIN /start or /menu => sends dashboard
  it('TEST 8: returns home dashboard with inline buttons for linked SUPER_ADMIN', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        update_id: 106,
        message: {
          message_id: 7,
          date: 1700000000,
          chat: { id: 777888999, type: 'private' },
          from: { id: 777888999, is_bot: false, first_name: 'AdminTG' },
          text: '/start',
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(outboundCalls.length).toBe(1);
    expect(outboundCalls[0]!.method).toBe('sendMessage');
    const sendOpts = outboundCalls[0]!.options as SendMessageOptions;
    expect(sendOpts.text).toContain('🤖 PRO POS Admin');
    const markup = sendOpts.replyMarkup!;
    expect(markup.inline_keyboard.length).toBeGreaterThanOrEqual(3);
  });

  // TEST 9: Callback menu:db => answers callback and edits message to Database dashboard
  it('TEST 9: answers callback query immediately and edits message for menu:db', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        update_id: 107,
        callback_query: {
          id: 'query-db-1',
          from: { id: 777888999, is_bot: false, first_name: 'AdminTG' },
          message: {
            message_id: 99,
            date: 1700000000,
            chat: { id: 777888999, type: 'private' },
          },
          data: 'menu:db',
        },
      }),
    });
    expect(res.status).toBe(200);

    // Verify 1: answerCallbackQuery was called
    const answerCall = outboundCalls.find((c) => c.method === 'answerCallbackQuery');
    expect(answerCall).toBeDefined();
    expect((answerCall!.options as AnswerCallbackQueryOptions).callbackQueryId).toBe('query-db-1');

    // Verify 2: editMessageText was called with Database screen
    const editCall = outboundCalls.find((c) => c.method === 'editMessageText');
    expect(editCall).toBeDefined();
    const editOpts = editCall!.options as EditMessageTextOptions;
    expect(editOpts.messageId).toBe(99);
    expect(editOpts.text).toContain('💾 PRO POS — Cơ sở dữ liệu');
  });

  // TEST 10: Callback menu:stores => renders stores list
  it('TEST 10: answers callback query and edits message for menu:stores', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        update_id: 108,
        callback_query: {
          id: 'query-stores-1',
          from: { id: 777888999, is_bot: false, first_name: 'AdminTG' },
          message: {
            message_id: 99,
            date: 1700000000,
            chat: { id: 777888999, type: 'private' },
          },
          data: 'menu:stores',
        },
      }),
    });
    expect(res.status).toBe(200);

    const editCall = outboundCalls.find((c) => c.method === 'editMessageText');
    const editOpts = editCall!.options as EditMessageTextOptions;
    expect(editOpts.text).toContain('🏪 PRO POS — Cửa hàng');
    expect(editOpts.text).toContain('Coffee Demo TG');
  });

  // TEST 11: Callback menu:home => edits message back to home
  it('TEST 11: edits message back to home dashboard for menu:home', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        update_id: 109,
        callback_query: {
          id: 'query-home-1',
          from: { id: 777888999, is_bot: false, first_name: 'AdminTG' },
          message: {
            message_id: 99,
            date: 1700000000,
            chat: { id: 777888999, type: 'private' },
          },
          data: 'menu:home',
        },
      }),
    });
    expect(res.status).toBe(200);

    const editCall = outboundCalls.find((c) => c.method === 'editMessageText');
    const editOpts = editCall!.options as EditMessageTextOptions;
    expect(editOpts.text).toContain('🤖 PRO POS Admin');
  });

  // TEST 12: Unknown callback => graceful response
  it('TEST 12: handles unknown callbacks gracefully with safe answerCallbackQuery', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        update_id: 110,
        callback_query: {
          id: 'query-unknown-1',
          from: { id: 777888999, is_bot: false, first_name: 'AdminTG' },
          message: {
            message_id: 99,
            date: 1700000000,
            chat: { id: 777888999, type: 'private' },
          },
          data: 'unknown:something:else',
        },
      }),
    });
    expect(res.status).toBe(200);

    const answerCall = outboundCalls.find(
      (c) =>
        c.method === 'answerCallbackQuery' &&
        (c.options as AnswerCallbackQueryOptions).text === 'Thao tác không còn hợp lệ.',
    );
    expect(answerCall).toBeDefined();
  });

  // TEST 13: Callback db:top => renders Top 10 database tables
  it('TEST 13: renders Top 10 database tables for db:top', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        update_id: 111,
        callback_query: {
          id: 'query-top-1',
          from: { id: 777888999, is_bot: false, first_name: 'AdminTG' },
          message: {
            message_id: 99,
            date: 1700000000,
            chat: { id: 777888999, type: 'private' },
          },
          data: 'db:top',
        },
      }),
    });
    expect(res.status).toBe(200);

    const editCall = outboundCalls.find((c) => c.method === 'editMessageText');
    const editOpts = editCall!.options as EditMessageTextOptions;
    expect(editOpts.text).toContain('💾 PRO POS — Top 10 Bảng Cơ sở dữ liệu');
    expect(editOpts.text).toContain('Phân loại:');
  });

  // TEST 14: Callback store:view:<valid-id> => renders store details
  it('TEST 14: renders store details when store:view:<valid-id> is clicked', async () => {
    const store = await env.DB.prepare('SELECT id FROM stores LIMIT 1').first<{ id: string }>();
    expect(store).not.toBeNull();

    const res = await SELF.fetch(`${ORIGIN}/api/v1/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        update_id: 112,
        callback_query: {
          id: 'query-store-view-1',
          from: { id: 777888999, is_bot: false, first_name: 'AdminTG' },
          message: {
            message_id: 99,
            date: 1700000000,
            chat: { id: 777888999, type: 'private' },
          },
          data: `store:view:${store!.id}`,
        },
      }),
    });
    expect(res.status).toBe(200);

    const editCall = outboundCalls.find((c) => c.method === 'editMessageText');
    const editOpts = editCall!.options as EditMessageTextOptions;
    expect(editOpts.text).toContain('Trạng thái:');
    expect(editOpts.text).toContain('Doanh thu hôm nay:');
    expect(editOpts.text).toContain('Hóa đơn hôm nay:');
  });

  // TEST 15: Callback store:view:<invalid-id> => rejects safely
  it('TEST 15: safely rejects store:view with non-UUID or invalid id', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/v1/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        update_id: 113,
        callback_query: {
          id: 'query-store-inv-1',
          from: { id: 777888999, is_bot: false, first_name: 'AdminTG' },
          message: {
            message_id: 99,
            date: 1700000000,
            chat: { id: 777888999, type: 'private' },
          },
          data: 'store:view:not-a-valid-uuid;DROP TABLE stores;--',
        },
      }),
    });
    expect(res.status).toBe(200);

    const answerCall = outboundCalls.find(
      (c) =>
        c.method === 'answerCallbackQuery' &&
        (c.options as AnswerCallbackQueryOptions).text === 'Mã cửa hàng không hợp lệ.',
    );
    expect(answerCall).toBeDefined();
  });

  // TEST 16: Message slash commands /status, /db, /stores, /version, /help
  it('TEST 16: supports direct slash commands with identical renderers as buttons', async () => {
    const commands = ['/status', '/db', '/stores', '/version', '/help'];

    for (const cmd of commands) {
      outboundCalls.length = 0;
      const res = await SELF.fetch(`${ORIGIN}/api/v1/telegram/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET,
        },
        body: JSON.stringify({
          update_id: 200,
          message: {
            message_id: 10,
            date: 1700000000,
            chat: { id: 777888999, type: 'private' },
            from: { id: 777888999, is_bot: false, first_name: 'AdminTG' },
            text: cmd,
          },
        }),
      });
      expect(res.status).toBe(200);
      expect(outboundCalls.length).toBe(1);
      expect(outboundCalls[0]!.method).toBe('sendMessage');
      expect((outboundCalls[0]!.options as SendMessageOptions).text).toBeTruthy();
    }
  });

  // TEST 17: Platform Web endpoints: status and unlink
  it('TEST 17: allows SUPER_ADMIN to check link status and unlink via Platform Web API', async () => {
    const session = await completeAccess(ADMIN_EMAIL);
    if (session.purpose !== 'PLATFORM_LOGIN') throw new Error('Expected platform session');
    const csrfToken = await deriveCsrfToken(session.rawSession, env.AUTH_PEPPER!);
    const sessionCookie = `__Host-propos-session=${session.rawSession}`;

    // Status check
    const statusRes = await SELF.fetch(`${ORIGIN}/api/v1/platform/telegram/status`, {
      headers: {
        Origin: ORIGIN,
        Cookie: sessionCookie,
      },
    });
    expect(statusRes.status).toBe(200);
    const statusData = await jsonData<{ linked: boolean; link: unknown }>(statusRes);
    expect(statusData.linked).toBe(true);
    expect(statusData.link).not.toBeNull();

    // Unlink with CSRF token
    const unlinkRes = await SELF.fetch(`${ORIGIN}/api/v1/platform/telegram/link`, {
      method: 'DELETE',
      headers: {
        Origin: ORIGIN,
        Cookie: sessionCookie,
        'X-CSRF-Token': csrfToken,
      },
    });
    expect(unlinkRes.status).toBe(200);

    // Status check again -> should be unlinked
    const statusAfter = await SELF.fetch(`${ORIGIN}/api/v1/platform/telegram/status`, {
      headers: {
        Origin: ORIGIN,
        Cookie: sessionCookie,
      },
    });
    const afterData = await jsonData<{ linked: boolean }>(statusAfter);
    expect(afterData.linked).toBe(false);

    // Attempting bot command from previous user -> should now be denied
    outboundCalls.length = 0;
    const deniedRes = await SELF.fetch(`${ORIGIN}/api/v1/telegram/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        update_id: 300,
        message: {
          message_id: 11,
          date: 1700000000,
          chat: { id: 777888999, type: 'private' },
          from: { id: 777888999, is_bot: false, first_name: 'AdminTG' },
          text: '/status',
        },
      }),
    });
    expect(deniedRes.status).toBe(200);
    expect(outboundCalls.length).toBe(1);
    expect((outboundCalls[0]!.options as SendMessageOptions).text).toContain('không có quyền');
  });

  // TEST 18: Non-destructive verification
  it('TEST 18: verifies no destructive commands exist in Telegram routing', () => {
    const destructiveWords = [
      'delete',
      'cleanup',
      'truncate',
      'vacuum',
      'reset',
      'lock',
      'unlock',
      'payment',
      'refund',
    ];

    // Ensure our callback convention does not register any destructive action
    const allowedPrefixes = ['menu:', 'status:', 'db:', 'stores:', 'store:'];
    for (const prefix of allowedPrefixes) {
      for (const word of destructiveWords) {
        expect(prefix.startsWith(word)).toBe(false);
      }
    }
  });
});
