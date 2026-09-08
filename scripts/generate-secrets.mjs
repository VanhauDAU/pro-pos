import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
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

let existingContent = null;
try {
  existingContent = await readFile(outputPath, 'utf8');
} catch (err) {
  if (err && err.code !== 'ENOENT') {
    throw err;
  }
}

if (existingContent === null) {
  const vapid = webpush.generateVAPIDKeys();
  const lines = names.map((name) => `${name}=${randomBytes(48).toString('base64url')}`);
  lines.push(`VAPID_PUBLIC_KEY=${vapid.publicKey}`);
  lines.push(`VAPID_PRIVATE_KEY=${vapid.privateKey}`);
  lines.push(`VAPID_SUBJECT=mailto:vanhau.laravel@gmail.com`);

  const content = `${lines.join('\n')}\n`;
  await writeFile(outputPath, content, { encoding: 'utf8', mode: 0o600 });
  console.log(
    `Created ${outputPath} with mode 0600 (including VAPID keys). Secret values were not printed.`,
  );
} else {
  const existingKeys = new Set(
    existingContent
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => line.split('=')[0].trim()),
  );

  const missingLines = [];
  const needsVapid =
    !existingKeys.has('VAPID_PUBLIC_KEY') || !existingKeys.has('VAPID_PRIVATE_KEY');
  const vapid = needsVapid ? webpush.generateVAPIDKeys() : null;

  for (const name of names) {
    if (!existingKeys.has(name)) {
      missingLines.push(`${name}=${randomBytes(48).toString('base64url')}`);
    }
  }

  if (!existingKeys.has('VAPID_PUBLIC_KEY') && vapid) {
    missingLines.push(`VAPID_PUBLIC_KEY=${vapid.publicKey}`);
  }
  if (!existingKeys.has('VAPID_PRIVATE_KEY') && vapid) {
    missingLines.push(`VAPID_PRIVATE_KEY=${vapid.privateKey}`);
  }
  if (!existingKeys.has('VAPID_SUBJECT')) {
    missingLines.push(`VAPID_SUBJECT=mailto:vanhau.laravel@gmail.com`);
  }

  if (missingLines.length === 0) {
    console.log(
      `${outputPath} already exists and contains all required secrets (including VAPID keys).`,
    );
  } else {
    const separator = existingContent.endsWith('\n') ? '' : '\n';
    const updatedContent = `${existingContent}${separator}${missingLines.join('\n')}\n`;
    await writeFile(outputPath, updatedContent, { encoding: 'utf8', mode: 0o600 });
    const addedNames = missingLines.map((l) => l.split('=')[0]);
    console.log(
      `Appended missing secrets to ${outputPath}: ${addedNames.join(', ')}. Existing secrets were preserved.`,
    );
  }
}
