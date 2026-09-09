import { Hono } from 'hono';

import { AppError } from '@server/lib/app-error';
import { safeEqualSecret } from '@server/lib/crypto';
import type { AppEnv } from '@server/types';
import { TelegramCommandService } from '../integrations/telegram/telegram-command-service';
import type { TelegramUpdate } from '../integrations/telegram/telegram-types';

const telegramRoutes = new Hono<AppEnv>();

telegramRoutes.post('/webhook', async (c) => {
  const secretHeader = c.req.header('X-Telegram-Bot-Api-Secret-Token');
  const expectedSecret = c.env.TELEGRAM_WEBHOOK_SECRET;

  if (!secretHeader || !expectedSecret || !safeEqualSecret(secretHeader, expectedSecret)) {
    throw new AppError('WEBHOOK_FORBIDDEN', 'Không được phép.', 403);
  }

  let update: TelegramUpdate | null = null;
  try {
    update = (await c.req.json()) as TelegramUpdate;
  } catch {
    return c.json({ ok: true, ignored: true }, 200);
  }

  if (!update || typeof update !== 'object' || typeof update.update_id !== 'number') {
    return c.json({ ok: true, ignored: true }, 200);
  }

  const commandService = new TelegramCommandService(c.env);
  try {
    await commandService.handleUpdate(update);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'error handling telegram update',
        updateId: update.update_id,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  return c.json({ ok: true });
});

export { telegramRoutes };
