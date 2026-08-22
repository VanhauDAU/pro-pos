import { execSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const environment = process.argv[2] || 'local';

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

const files = readdirSync(soundDir).filter((f) => /\.(ogg|mp3|wav)$/i.test(f));

console.log(`Uploading ${files.length} sound files to R2 bucket "${bucketName}" (${environment})...`);

for (const file of files) {
  const filePath = join(soundDir, file);
  const r2Key = `sound/${file}`;
  console.log(` -> Putting ${r2Key}...`);
  try {
    let cmd = `npx wrangler r2 object put "${bucketName}/${r2Key}" --file="${filePath}"`;
    if (environment === 'local') {
      cmd += ' --local';
    } else {
      cmd += ` --env ${environment}`;
    }
    execSync(cmd, { stdio: 'inherit' });
  } catch (err) {
    console.error(`Failed to upload ${file}:`, err.message);
  }
}

console.log('✅ Sound files uploaded to R2 successfully!');
