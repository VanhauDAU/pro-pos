import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';

const environment = process.argv[2];

if (!['local', 'staging', 'production'].includes(environment)) {
  throw new Error('Usage: node scripts/bootstrap-platform.mjs <local|staging|production>');
}

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

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

if (environment === 'local') {
  let devVars = {};
  try {
    const devVarsContent = await readFile('.dev.vars', 'utf8');
    devVars = parseEnvFile(devVarsContent);
  } catch {
    // .dev.vars is optional
  }

  const username =
    process.env.LOCAL_SUPER_ADMIN_USERNAME || devVars.LOCAL_SUPER_ADMIN_USERNAME || 'admin';
  const email = (
    process.env.LOCAL_SUPER_ADMIN_EMAIL ||
    devVars.LOCAL_SUPER_ADMIN_EMAIL ||
    'vanhau.laravel@gmail.com'
  ).toLowerCase();
  const password =
    process.env.LOCAL_SUPER_ADMIN_PASSWORD ||
    devVars.LOCAL_SUPER_ADMIN_PASSWORD ||
    'ProPOS@Local2026!';
  const displayName =
    process.env.LOCAL_SUPER_ADMIN_DISPLAY_NAME ||
    devVars.LOCAL_SUPER_ADMIN_DISPLAY_NAME ||
    'Lê Văn Hậu';
  const authPepper = process.env.AUTH_PEPPER || devVars.AUTH_PEPPER || 'local-dev-auth-pepper';

  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const salt = bytesToBase64Url(saltBytes);

  const encoder = new TextEncoder();
  const rawPeppered = `${password}\u0000${authPepper}`;
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(rawPeppered),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: 'SHA-256',
    },
    baseKey,
    256,
  );
  const digest = bytesToBase64Url(new Uint8Array(derivedBits));

  const checkCommand = `npx wrangler d1 execute DB --local --command "SELECT id FROM users WHERE platform_role = 'SUPER_ADMIN' OR username = '${username}' OR email = '${email}' LIMIT 1;" --json`;
  let existingUser = null;
  try {
    const checkOutput = execSync(checkCommand, { encoding: 'utf8' });
    const parsed = JSON.parse(checkOutput);
    const results = parsed?.[0]?.results;
    if (results && results.length > 0) {
      existingUser = results[0];
    }
  } catch (err) {
    console.warn('Could not query local DB directly, proceeding with upsert:', err.message);
  }

  const now = Date.now();
  const userId = existingUser?.id || crypto.randomUUID();

  const sqlStatements = [
    `INSERT INTO users (id, platform_role, username, email, display_name, status, must_change_password, created_at, updated_at)
     VALUES ('${userId}', 'SUPER_ADMIN', '${username}', '${email}', '${displayName}', 'ACTIVE', 0, ${now}, ${now})
     ON CONFLICT(id) DO UPDATE SET
       platform_role = 'SUPER_ADMIN',
       username = excluded.username,
       email = excluded.email,
       display_name = excluded.display_name,
       status = 'ACTIVE',
       updated_at = excluded.updated_at;`,
    `INSERT INTO access_identities (user_id, provider, email, credential_version, created_at, updated_at)
     VALUES ('${userId}', 'CLOUDFLARE_ACCESS', '${email}', 1, ${now}, ${now})
     ON CONFLICT(user_id) DO UPDATE SET
       email = excluded.email,
       credential_version = credential_version + 1,
       updated_at = excluded.updated_at;`,
    `INSERT INTO password_credentials (user_id, algorithm, work_factor, salt, digest, pepper_version, credential_version, updated_at)
     VALUES ('${userId}', 'PBKDF2-HMAC-SHA256', 100000, '${salt}', '${digest}', 1, 1, ${now})
     ON CONFLICT(user_id) DO UPDATE SET
       salt = excluded.salt,
       digest = excluded.digest,
       credential_version = credential_version + 1,
       updated_at = excluded.updated_at;`,
  ].join(' ');

  const executeCommand = `npx wrangler d1 execute DB --local --command "${sqlStatements.replaceAll('"', '\\"')}"`;
  execSync(executeCommand, { stdio: 'inherit' });

  console.log('\n========================================');
  console.log('✅ Khởi tạo SUPER_ADMIN LOCAL thành công!');
  console.log(`- Username:     ${username}`);
  console.log(`- Email:        ${email}`);
  console.log(`- Password:     ${password}`);
  console.log(`- Display Name: ${displayName}`);
  console.log(`- Role:         SUPER_ADMIN`);
  console.log('========================================\n');
  process.exit(0);
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
