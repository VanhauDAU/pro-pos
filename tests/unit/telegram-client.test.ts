import { describe, expect, it, vi } from 'vitest';

import { TelegramClient, TelegramClientError } from '@server/integrations/telegram/telegram-client';

describe('TelegramClient', () => {
  const MOCK_TOKEN = '123456789:ABCdefGHIjklMNOpqrsTUVwxyz';

  it('throws an error if instantiated with empty token', () => {
    expect(() => new TelegramClient('')).toThrow('TELEGRAM_BOT_TOKEN must not be empty.');
  });

  it('sends sendMessage with correct parameters', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        result: {
          message_id: 42,
          date: 1700000000,
          chat: { id: 12345, type: 'private' },
          text: 'Hello Admin',
        },
      }),
    });

    const client = new TelegramClient(MOCK_TOKEN, mockFetch as unknown as typeof fetch);
    const result = await client.sendMessage({
      chatId: 12345,
      text: 'Hello Admin',
      replyMarkup: {
        inline_keyboard: [[{ text: 'Button 1', callback_data: 'test:data' }]],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.result?.message_id).toBe(42);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [calledUrl, calledOptions] = mockFetch.mock.calls[0]!;
    expect(calledUrl).toBe(`https://api.telegram.org/bot${MOCK_TOKEN}/sendMessage`);
    expect(JSON.parse(calledOptions?.body as string)).toEqual({
      chat_id: 12345,
      text: 'Hello Admin',
      reply_markup: {
        inline_keyboard: [[{ text: 'Button 1', callback_data: 'test:data' }]],
      },
    });
  });

  it('sends editMessageText with correct parameters', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        result: {
          message_id: 99,
          date: 1700000000,
          chat: { id: 12345, type: 'private' },
          text: 'Updated text',
        },
      }),
    });

    const client = new TelegramClient(MOCK_TOKEN, mockFetch as unknown as typeof fetch);
    const result = await client.editMessageText({
      chatId: 12345,
      messageId: 99,
      text: 'Updated text',
      replyMarkup: {
        inline_keyboard: [[{ text: 'Home', callback_data: 'menu:home' }]],
      },
    });

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [calledUrl, calledOptions] = mockFetch.mock.calls[0]!;
    expect(calledUrl).toBe(`https://api.telegram.org/bot${MOCK_TOKEN}/editMessageText`);
    expect(JSON.parse(calledOptions?.body as string)).toEqual({
      chat_id: 12345,
      message_id: 99,
      text: 'Updated text',
      reply_markup: {
        inline_keyboard: [[{ text: 'Home', callback_data: 'menu:home' }]],
      },
    });
  });

  it('gracefully handles "message is not modified" error from editMessageText', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        ok: false,
        error_code: 400,
        description:
          'Bad Request: message is not modified: specified new message content and reply markup are exactly the same',
      }),
    });

    const client = new TelegramClient(MOCK_TOKEN, mockFetch as unknown as typeof fetch);
    const result = await client.editMessageText({
      chatId: 12345,
      messageId: 99,
      text: 'Same text',
    });

    // Should return ok: true rather than throwing an unhandled exception
    expect(result.ok).toBe(true);
  });

  it('sends answerCallbackQuery with correct parameters', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        result: true,
      }),
    });

    const client = new TelegramClient(MOCK_TOKEN, mockFetch as unknown as typeof fetch);
    const result = await client.answerCallbackQuery({
      callbackQueryId: 'cb_query_123',
      text: 'Notification toast',
      showAlert: false,
    });

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [calledUrl, calledOptions] = mockFetch.mock.calls[0]!;
    expect(calledUrl).toBe(`https://api.telegram.org/bot${MOCK_TOKEN}/answerCallbackQuery`);
    expect(JSON.parse(calledOptions?.body as string)).toEqual({
      callback_query_id: 'cb_query_123',
      text: 'Notification toast',
      show_alert: false,
    });
  });

  it('masks bot token completely in errors and never leaks secrets in messages', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        ok: false,
        error_code: 401,
        description: `Unauthorized token ${MOCK_TOKEN}`,
      }),
    });

    const client = new TelegramClient(MOCK_TOKEN, mockFetch as unknown as typeof fetch);
    await expect(client.sendMessage({ chatId: 123, text: 'Hi' })).rejects.toThrowError(
      TelegramClientError,
    );

    try {
      await client.sendMessage({ chatId: 123, text: 'Hi' });
    } catch (err: unknown) {
      const error = err as TelegramClientError;
      expect(error.message).not.toContain(MOCK_TOKEN);
      expect(error.message).toContain('[REDACTED_BOT_TOKEN]');
      expect(error.description).not.toContain(MOCK_TOKEN);
      expect(error.description).toContain('[REDACTED_BOT_TOKEN]');
    }
  });
});
