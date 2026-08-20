import { readFile } from 'node:fs/promises';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';

const environment = process.argv[2];

if (!['staging', 'production'].includes(environment)) {
  throw new Error('Usage: node scripts/bootstrap-platform.mjs <staging|production>');
}

function parseEnvFile(content) {
  return Object.fromEntries(
    content
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=');
        if (separator < 1) throw new Error('Invalid secrets file format.');
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

const secretsPath = `.env.${environment}.secrets`;
const secrets = parseEnvFile(await readFile(secretsPath, 'utf8'));
const bootstrapSecret = secrets.SYSTEM_BOOTSTRAP_SECRET;

if (!bootstrapSecret) {
  throw new Error(`SYSTEM_BOOTSTRAP_SECRET is missing from ${secretsPath}.`);
}

const defaultUrl =
  environment === 'staging'
    ? 'https://pro-pos-staging.vanhau-laravel.workers.dev'
    : 'https://pro-pos-production.vanhau-laravel.workers.dev';
const baseUrl = process.env.PRO_POS_URL ?? defaultUrl;
const origin = new URL(baseUrl).origin;
const prompt = createInterface({ input: stdin, output: stdout });
const email = (await prompt.question('SUPER_ADMIN email allowed by Cloudflare Access: '))
  .trim()
  .toLowerCase();
const displayName = (await prompt.question('Display name: ')).trim();
prompt.close();

if (!email.includes('@') || !displayName) {
  throw new Error('Email or display name is invalid.');
}

const response = await fetch(`${origin}/api/v1/platform/bootstrap`, {
  method: 'POST',
  headers: {
    Origin: origin,
    'Content-Type': 'application/json',
    'X-Bootstrap-Secret': bootstrapSecret,
  },
  body: JSON.stringify({ email, displayName }),
});
const payload = await response.json();

if (!response.ok) {
  const code = payload?.error?.code ?? `HTTP_${response.status}`;
  const message = payload?.error?.message ?? 'Bootstrap failed.';
  throw new Error(`${code}: ${message}`);
}

console.log(`SUPER_ADMIN ${email} created successfully in ${environment}.`);
console.log('Add this exact email to the Cloudflare Access allow policy before signing in.');
