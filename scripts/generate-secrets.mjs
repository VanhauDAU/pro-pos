import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

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
const content = `${names
  .map((name) => `${name}=${randomBytes(48).toString('base64url')}`)
  .join('\n')}\n`;

await writeFile(outputPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
console.log(`Created ${outputPath} with mode 0600. Secret values were not printed.`);
