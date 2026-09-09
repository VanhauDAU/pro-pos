export interface TelegramUser {
  id: number | string;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export type TelegramChatType = 'private' | 'group' | 'supergroup' | 'channel';

export interface TelegramChat {
  id: number | string;
  type: TelegramChatType;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  reply_markup?: TelegramInlineKeyboardMarkup;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  inline_message_id?: string;
  chat_instance?: string;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export interface SendMessageOptions {
  chatId: number | string;
  text: string;
  replyMarkup?: TelegramInlineKeyboardMarkup;
  parseMode?: 'HTML' | 'MarkdownV2';
}

export interface EditMessageTextOptions {
  chatId: number | string;
  messageId: number;
  text: string;
  replyMarkup?: TelegramInlineKeyboardMarkup;
  parseMode?: 'HTML' | 'MarkdownV2';
}

export interface AnswerCallbackQueryOptions {
  callbackQueryId: string;
  text?: string;
  showAlert?: boolean;
  cacheTime?: number;
}

export interface DeleteMessageOptions {
  chatId: number | string;
  messageId: number;
}

export interface BuiltMessage {
  text: string;
  replyMarkup: TelegramInlineKeyboardMarkup;
}

export interface TelegramAdminLinkRecord {
  id: string;
  userId: string;
  telegramUserId: string;
  telegramUsername: string | null;
  telegramFirstName: string | null;
  telegramLastName: string | null;
  telegramChatId: string | null;
  linkedAt: number;
  updatedAt: number;
}

export interface TelegramAuthorizedAdmin {
  link: TelegramAdminLinkRecord;
  user: {
    id: string;
    displayName: string;
    username: string;
    email: string | null;
    status: 'ACTIVE' | 'DISABLED';
    platformRole: 'SUPER_ADMIN' | null;
  };
}
