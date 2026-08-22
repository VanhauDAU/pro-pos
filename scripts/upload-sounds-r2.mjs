import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const environment = process.argv[2] || 'local';
const guestOnly = process.argv.includes('--guest-only');

if (!['local', 'staging', 'production'].includes(environment)) {
  console.error('Usage: node scripts/upload-sounds-r2.mjs <local|staging|production>');
  process.exit(1);
}

const bucketMap = {
  local: 'pro-pos-local-media',
  staging: 'pro-pos-staging-media',
  production: 'pro-pos-production-media',
};

const bucketName = bucketMap[environment];
const soundDir = join(process.cwd(), 'public', 'sound');

if (!existsSync(soundDir)) {
  console.error('Sound directory not found:', soundDir);
  process.exit(1);
}

const files = readdirSync(soundDir)
  .filter((file) => /\.(ogg|mp3|wav)$/i.test(file))
  .filter((file) => !guestOnly || file.startsWith('guest_'))
  .toSorted();

console.log(
  `Uploading ${files.length} sound files to R2 bucket "${bucketName}" (${environment})...`,
);

for (const file of files) {
  const filePath = join(soundDir, file);
  const r2Key = `sound/${file}`;
  console.log(` -> Putting ${r2Key}...`);
  const contentType = file.toLowerCase().endsWith('.ogg')
    ? 'audio/ogg'
    : file.toLowerCase().endsWith('.wav')
      ? 'audio/wav'
      : 'audio/mpeg';
  const args = [
    'exec',
    'wrangler',
    'r2',
    'object',
    'put',
    `${bucketName}/${r2Key}`,
    `--file=${filePath}`,
    `--content-type=${contentType}`,
    '--cache-control=public, max-age=31536000, immutable',
    ...(environment === 'local' ? ['--local'] : ['--remote', '--env', environment]),
  ];
  execFileSync('pnpm', args, { stdio: 'inherit' });
}

console.log('✅ Sound files uploaded to R2 successfully!');
