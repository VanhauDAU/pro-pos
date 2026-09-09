#!/usr/bin/env node

/**
 * Local Telegram Polling Bridge for Development
 *
 * Allows testing Telegram Bot on localhost without needing ngrok/tunnel.
 * It polls Telegram via getUpdates and forwards updates to your local server.
 *
 * Usage:
 *   pnpm bot:dev
 *   or
 *   TELEGRAM_BOT_TOKEN=... node scripts/dev-telegram-polling.mjs
 */

import { readFile } from 'node:fs/promises';

function parseEnvFile(content) {
  return Object.fromEntries(
    content
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=');
        if (separator < 1) return null;
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      })
      .filter(Boolean),
  );
}

async function loadConfig() {
  let devVars = {};
  try {
    const raw = await readFile('.dev.vars', 'utf8');
    devVars = parseEnvFile(raw);
  } catch {
    // optional
  }

  const token = (process.env.TELEGRAM_BOT_TOKEN || devVars.TELEGRAM_BOT_TOKEN || '').trim();
  const secret = (
    process.env.TELEGRAM_WEBHOOK_SECRET ||
    devVars.TELEGRAM_WEBHOOK_SECRET ||
    'local-dev-webhook-secret'
  ).trim();
  const port = process.env.PORT || 5173;
  const webhookUrl = `http://127.0.0.1:${port}/api/v1/telegram/webhook`;

  return { token, secret, port, webhookUrl };
}

async function main() {
  const { token, secret, port, webhookUrl } = await loadConfig();

  if (!token) {
    console.error('\n❌ Không tìm thấy TELEGRAM_BOT_TOKEN!');
    console.error('Vui lòng thêm vào file .dev.vars:');
    console.error('  TELEGRAM_BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ');
    console.error('  TELEGRAM_WEBHOOK_SECRET=local-dev-webhook-secret\n');
    console.error('Hoặc chạy với biến môi trường:');
    console.error('  TELEGRAM_BOT_TOKEN=... pnpm bot:dev\n');
    process.exit(1);
  }

  const baseUrl = `https://api.telegram.org/bot${token}`;

  // 1. Get Bot info
  try {
    const meRes = await fetch(`${baseUrl}/getMe`);
    const meData = await meRes.json();
    if (!meData.ok) {
      console.error(`❌ Token không hợp lệ: ${meData.description}`);
      process.exit(1);
    }
    console.log(`\n🤖 Đã kết nối bot: @${meData.result.username} (${meData.result.first_name})`);
  } catch (err) {
    console.error('❌ Không thể kết nối tới api.telegram.org:', err.message);
    process.exit(1);
  }

  // 2. Delete webhook so getUpdates works
  try {
    console.log('🔄 Đang cấu hình chế độ Polling (xóa webhook cũ nếu có)...');
    await fetch(`${baseUrl}/deleteWebhook?drop_pending_updates=false`);
  } catch (err) {
    console.warn('⚠️ Cảnh báo deleteWebhook:', err.message);
  }

  console.log(`🚀 Đang chuyển tiếp tin nhắn tới: ${webhookUrl}`);
  console.log('💬 Hãy mở Telegram và gửi /start hoặc /menu vào bot...\n');

  let offset = 0;
  process.on('SIGINT', () => {
    console.log('\n🛑 Đang dừng polling bridge...');
    process.exit(0);
  });

  while (true) {
    try {
      const url = `${baseUrl}/getUpdates?offset=${offset}&timeout=15&allowed_updates=["message","callback_query"]`;
      const response = await fetch(url);
      const data = await response.json();

      if (!data.ok) {
        console.error('⚠️ Telegram getUpdates error:', data.description);
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }

      const updates = data.result || [];
      for (const update of updates) {
        offset = update.update_id + 1;

        const updateType = update.message
          ? 'tin nhắn'
          : update.callback_query
            ? 'nút bấm'
            : 'update';
        const sender =
          update.message?.from?.username ||
          update.message?.from?.first_name ||
          update.callback_query?.from?.username ||
          'unknown';

        console.log(`📩 Nhận ${updateType} từ @${sender} (id: ${update.update_id})`);

        try {
          const forwardRes = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Telegram-Bot-Api-Secret-Token': secret,
            },
            body: JSON.stringify(update),
          });

          if (!forwardRes.ok) {
            const errText = await forwardRes.text();
            console.error(`   ⚠️ Local server trả về lỗi [${forwardRes.status}]: ${errText}`);
          } else {
            console.log(`   ✅ Đã xử lý xong [HTTP ${forwardRes.status}]`);
          }
        } catch (fwdErr) {
          console.error(
            `   ❌ Không thể gửi tới ${webhookUrl}. Bạn đã bật server 'pnpm dev' trên port ${port} chưa?`,
            fwdErr.message,
          );
        }
      }
    } catch (err) {
      console.error('⚠️ Lỗi polling loop:', err.message);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

main().catch(console.error);
