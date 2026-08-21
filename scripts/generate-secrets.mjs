import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import webpush from 'web-push';

const environment = process.argv[2];

if (!['staging', 'production'].includes(environment)) {
  throw new Error('Usage: node scripts/generate-secrets.mjs <staging|production>');
}

const outputPath = `.env.${environment}.secrets`;
const names = [
  'AUTH_PEPPER',
  'DEVICE_TOKEN_PEPPER',
  'SESSION_TOKEN_PEPPER',
  'SYSTEM_BOOTSTRAP_SECRET',
];
const vapid = webpush.generateVAPIDKeys();
const lines = names.map((name) => `${name}=${randomBytes(48).toString('base64url')}`);
lines.push(`VAPID_PUBLIC_KEY=${vapid.publicKey}`);
lines.push(`VAPID_PRIVATE_KEY=${vapid.privateKey}`);
lines.push(`VAPID_SUBJECT=mailto:vanhau.laravel@gmail.com`);

const content = `${lines.join('\n')}\n`;

await writeFile(outputPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
console.log(
  `Created ${outputPath} with mode 0600 (including VAPID keys). Secret values were not printed.`,
);
