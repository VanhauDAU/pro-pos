import type {
  AnswerCallbackQueryOptions,
  DeleteMessageOptions,
  EditMessageTextOptions,
  SendMessageOptions,
  TelegramApiResponse,
  TelegramMessage,
} from './telegram-types';

export class TelegramClientError extends Error {
  readonly errorCode?: number | undefined;
  readonly description?: string | undefined;

  constructor(message: string, errorCode?: number | undefined, description?: string | undefined) {
    super(message);
    this.name = 'TelegramClientError';
    this.errorCode = errorCode;
    this.description = description;
  }
}

export class TelegramClient {
  private readonly baseUrl: string;
  private readonly fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

  constructor(
    private readonly botToken: string,
    customFetch?: typeof fetch,
  ) {
    if (!botToken || botToken.trim().length === 0) {
      throw new Error('TELEGRAM_BOT_TOKEN must not be empty.');
    }
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
    this.fetcher = customFetch
      ? (input, init) => customFetch(input, init)
      : (input, init) => fetch(input, init);
  }

  private maskToken(str: string): string {
    if (!str || !this.botToken) return str;
    return str.replaceAll(this.botToken, '[REDACTED_BOT_TOKEN]');
  }

  private async callApi<T>(
    endpoint: string,
    body: Record<string, unknown>,
  ): Promise<TelegramApiResponse<T>> {
    const url = `${this.baseUrl}/${endpoint}`;
    try {
      const response = await this.fetcher(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = (await response.json()) as TelegramApiResponse<T>;

      if (!response.ok || !data.ok) {
        const desc = this.maskToken(data.description || `HTTP ${response.status}`);
        // Special case: Telegram returns 400 with "message is not modified" if user clicked refresh but content didn't change
        if (
          endpoint === 'editMessageText' &&
          (desc.toLowerCase().includes('message is not modified') ||
            desc.toLowerCase().includes('content of the message was not modified'))
        ) {
          return { ok: true, result: undefined as unknown as T };
        }

        throw new TelegramClientError(
          `Telegram API error on ${endpoint}: ${desc}`,
          data.error_code || response.status,
          desc,
        );
      }

      return data;
    } catch (error) {
      if (error instanceof TelegramClientError) {
        throw error;
      }
      const rawMessage = error instanceof Error ? error.message : String(error);
      throw new TelegramClientError(
        `Failed to execute Telegram API ${endpoint}: ${this.maskToken(rawMessage)}`,
      );
    }
  }

  async sendMessage(options: SendMessageOptions): Promise<TelegramApiResponse<TelegramMessage>> {
    const body: Record<string, unknown> = {
      chat_id: options.chatId,
      text: options.text,
    };
    if (options.replyMarkup) {
      body.reply_markup = options.replyMarkup;
    }
    if (options.parseMode) {
      body.parse_mode = options.parseMode;
    }
    return this.callApi<TelegramMessage>('sendMessage', body);
  }

  async editMessageText(
    options: EditMessageTextOptions,
  ): Promise<TelegramApiResponse<TelegramMessage | boolean>> {
    const body: Record<string, unknown> = {
      chat_id: options.chatId,
      message_id: options.messageId,
      text: options.text,
    };
    if (options.replyMarkup) {
      body.reply_markup = options.replyMarkup;
    }
    if (options.parseMode) {
      body.parse_mode = options.parseMode;
    }
    return this.callApi<TelegramMessage | boolean>('editMessageText', body);
  }

  async answerCallbackQuery(
    options: AnswerCallbackQueryOptions,
  ): Promise<TelegramApiResponse<boolean>> {
    const body: Record<string, unknown> = {
      callback_query_id: options.callbackQueryId,
    };
    if (options.text) {
      body.text = options.text;
    }
    if (options.showAlert !== undefined) {
      body.show_alert = options.showAlert;
    }
    if (options.cacheTime !== undefined) {
      body.cache_time = options.cacheTime;
    }
    return this.callApi<boolean>('answerCallbackQuery', body);
  }

  async deleteMessage(options: DeleteMessageOptions): Promise<TelegramApiResponse<boolean>> {
    return this.callApi<boolean>('deleteMessage', {
      chat_id: options.chatId,
      message_id: options.messageId,
    });
  }
}
