#!/usr/bin/env node

/**
 * Configure Telegram Bot for PRO POS SUPER_ADMIN
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN=... node scripts/configure-telegram-bot.mjs [options]
 *
 * Options:
 *   --set-commands                     Register bot slash commands menu
 *   --set-description                  Set BotFather description and short description
 *   --webhook-url <url>                Set webhook URL (e.g. https://domain.com/api/v1/telegram/webhook)
 *   --webhook-secret <secret>          Secret token for webhook verification
 *   --drop-pending-updates             Drop pending updates when setting webhook
 *   --get-info                         Get bot information (getMe) and webhook info (getWebhookInfo)
 *   --delete-webhook                   Delete webhook (switch to polling/inactive)
 */

const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();

if (!botToken) {
  console.error('Error: TELEGRAM_BOT_TOKEN environment variable is required.');
  console.error(
    'Example: TELEGRAM_BOT_TOKEN=123456:ABC... node scripts/configure-telegram-bot.mjs --set-commands',
  );
  process.exit(1);
}

const baseUrl = `https://api.telegram.org/bot${botToken}`;

async function callTelegram(method, body = {}) {
  const url = `${baseUrl}/${method}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(`Telegram API error on ${method}: ${data.description || response.statusText}`);
  }
  return data.result;
}

const args = process.argv.slice(2);

function getArgValue(flag) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return null;
}

const hasFlag = (flag) => args.includes(flag);

async function main() {
  console.log('🤖 PRO POS Telegram Bot Configuration Utility');

  // If no flags passed, show help or run getMe
  if (args.length === 0) {
    const me = await callTelegram('getMe');
    console.log(`Connected to bot: @${me.username} (${me.first_name})`);
    console.log('\nRun with --help or see header of this script for options.');
    return;
  }

  if (hasFlag('--get-info')) {
    const me = await callTelegram('getMe');
    console.log(`\nBot Identity:`);
    console.log(`- Username: @${me.username}`);
    console.log(`- ID: ${me.id}`);
    console.log(`- Name: ${me.first_name}`);

    const webhookInfo = await callTelegram('getWebhookInfo');
    console.log(`\nWebhook Status:`);
    console.log(`- URL: ${webhookInfo.url || '(none)'}`);
    console.log(`- Has custom certificate: ${webhookInfo.has_custom_certificate}`);
    console.log(`- Pending update count: ${webhookInfo.pending_update_count}`);
    console.log(
      `- Last error date: ${webhookInfo.last_error_date ? new Date(webhookInfo.last_error_date * 1000).toISOString() : '(none)'}`,
    );
    console.log(`- Last error message: ${webhookInfo.last_error_message || '(none)'}`);
    console.log(`- Allowed updates: ${JSON.stringify(webhookInfo.allowed_updates || [])}`);
  }

  if (hasFlag('--set-commands')) {
    console.log('\nSetting bot commands...');
    const commands = [
      { command: 'start', description: 'Mở PRO POS Admin' },
      { command: 'menu', description: 'Menu chính' },
      { command: 'status', description: 'Tình trạng hệ thống' },
      { command: 'db', description: 'Cơ sở dữ liệu' },
      { command: 'stores', description: 'Cửa hàng' },
      { command: 'version', description: 'Phiên bản' },
      { command: 'help', description: 'Trợ giúp' },
    ];

    await callTelegram('setMyCommands', { commands });
    console.log('✅ Commands registered successfully:');
    commands.forEach((c) => console.log(`   /${c.command} - ${c.description}`));
  }

  if (hasFlag('--set-description')) {
    console.log('\nSetting bot description and about...');
    await callTelegram('setMyDescription', {
      description: 'Trợ lý quản trị hệ thống PRO POS dành cho quản trị viên được ủy quyền.',
    });
    await callTelegram('setMyShortDescription', {
      short_description: 'PRO POS Admin Monitoring Bot',
    });
    console.log('✅ Description & short description set successfully.');
  }

  const webhookUrl = getArgValue('--webhook-url');
  if (webhookUrl) {
    const secretToken = getArgValue('--webhook-secret') || process.env.TELEGRAM_WEBHOOK_SECRET;
    const dropPending = hasFlag('--drop-pending-updates');

    console.log(`\nConfiguring webhook: ${webhookUrl}...`);
    const payload = {
      url: webhookUrl,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: dropPending,
    };
    if (secretToken) {
      payload.secret_token = secretToken;
    }

    await callTelegram('setWebhook', payload);
    console.log(
      '✅ Webhook configured successfully with allowed_updates: ["message", "callback_query"].',
    );
  }

  if (hasFlag('--delete-webhook')) {
    console.log('\nDeleting webhook...');
    await callTelegram('deleteWebhook', {
      drop_pending_updates: hasFlag('--drop-pending-updates'),
    });
    console.log('✅ Webhook deleted.');
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
