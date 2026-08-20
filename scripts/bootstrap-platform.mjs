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

function readHidden(label) {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== 'function') {
      reject(new Error('A TTY is required for hidden password input.'));
      return;
    }

    let value = '';
    stdout.write(label);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();

    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };

    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\u0003') {
          cleanup();
          stdout.write('\n');
          reject(new Error('Cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (character === '\u007f') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            stdout.write('\b \b');
          }
          continue;
        }
        if (character >= ' ') {
          value += character;
          stdout.write('*');
        }
      }
    };

    stdin.on('data', onData);
  });
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
const username = (await prompt.question('SUPER_ADMIN username: ')).trim();
const displayName = (await prompt.question('Display name: ')).trim();
prompt.close();
const password = await readHidden('Password (minimum 12 characters): ');
const confirmation = await readHidden('Confirm password: ');

if (username.length < 3 || !displayName) {
  throw new Error('Username or display name is invalid.');
}
if (password.length < 12) {
  throw new Error('Password must contain at least 12 characters.');
}
if (password !== confirmation) {
  throw new Error('Password confirmation does not match.');
}

const response = await fetch(`${origin}/api/v1/platform/bootstrap`, {
  method: 'POST',
  headers: {
    Origin: origin,
    'Content-Type': 'application/json',
    'X-Bootstrap-Secret': bootstrapSecret,
  },
  body: JSON.stringify({ username, displayName, password }),
});
const payload = await response.json();

if (!response.ok) {
  const code = payload?.error?.code ?? `HTTP_${response.status}`;
  const message = payload?.error?.message ?? 'Bootstrap failed.';
  throw new Error(`${code}: ${message}`);
}

console.log(`SUPER_ADMIN created successfully in ${environment}.`);
