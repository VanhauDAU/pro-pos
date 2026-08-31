import { createHash, createHmac } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = resolve(repositoryRoot, 'apps/print-agent/release');
const packageJsonPath = resolve(repositoryRoot, 'apps/print-agent/package.json');

function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key, data) {
  return createHmac('sha256', key).update(data).digest();
}

function getSigningKey(secretKey, dateStamp, region, service) {
  const kDate = hmacSha256(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

class R2S3Client {
  constructor({ accountId, accessKeyId, secretAccessKey, bucketName, region = 'auto' }) {
    this.accountId = accountId;
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.bucketName = bucketName;
    this.region = region;
    this.service = 's3';
    this.host = `${accountId}.r2.cloudflarestorage.com`;
    this.endpoint = `https://${this.host}`;
  }

  async sendRequest({ method, key, body = null, headers = {} }) {
    const encodedKey = key
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/');
    const path = `/${this.bucketName}/${encodedKey}`;
    const url = `${this.endpoint}${path}`;

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);

    const payloadHash = body ? sha256Hex(body) : sha256Hex('');

    const canonicalHeadersMap = {
      host: this.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...Object.fromEntries(
        Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()]),
      ),
    };

    const sortedHeaderKeys = Object.keys(canonicalHeadersMap).toSorted();
    const canonicalHeadersStr =
      sortedHeaderKeys.map((k) => `${k}:${canonicalHeadersMap[k]}\n`).join('') + '\n';
    const signedHeadersStr = sortedHeaderKeys.join(';');

    const canonicalRequest = [
      method,
      path,
      '', // query string
      canonicalHeadersStr.trim() + '\n',
      signedHeadersStr,
      payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${this.region}/${this.service}/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n');

    const signingKey = getSigningKey(this.secretAccessKey, dateStamp, this.region, this.service);
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    const authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`;

    const reqHeaders = {
      Host: this.host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      Authorization: authorization,
      ...headers,
    };

    const isBodyAllowed = method !== 'GET' && method !== 'HEAD';
    const fetchOptions = {
      method,
      headers: reqHeaders,
      ...(isBodyAllowed && body ? { body } : {}),
    };

    const response = await fetch(url, fetchOptions);

    return response;
  }

  async putObject({ key, body, contentType, cacheControl }) {
    const headers = {
      'content-type': contentType,
    };
    if (cacheControl) {
      headers['cache-control'] = cacheControl;
    }
    const res = await this.sendRequest({
      method: 'PUT',
      key,
      body,
      headers,
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`R2 PUT "${key}" failed (${res.status} ${res.statusText}): ${errText}`);
    }
    return res;
  }

  async headObject({ key }) {
    return this.sendRequest({
      method: 'HEAD',
      key,
    });
  }
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run');

  const accountId = process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey =
    process.env.R2_SECRET_ACCESS_KEY || process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  const bucketName =
    process.env.R2_BUCKET_NAME || process.env.CLOUDFLARE_R2_BUCKET_NAME || 'propos-updates';
  const workerUrl = (
    process.env.WORKER_URL ||
    process.env.FEED_BASE_URL ||
    'https://pro-pos-production.vanhau-laravel.workers.dev'
  ).replace(/\/$/, '');
  const feedPrefix = process.env.CLOUDFLARE_R2_FEED_PREFIX || 'print-agent/windows/stable';

  const pkg = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const version = pkg.version;

  console.log(
    `[R2Publisher] Preparing to publish PRO POS Print Agent v${version} updater artifacts...`,
  );
  console.log(`  - Target Bucket: ${bucketName}`);
  console.log(`  - Feed Prefix:   ${feedPrefix}`);
  console.log(`  - Worker Feed:   ${workerUrl}/${feedPrefix}/`);

  if (!accountId || !accessKeyId || !secretAccessKey) {
    if (isDryRun) {
      console.log(
        '[R2Publisher] Dry-run mode: R2 credentials not set, skipping upload simulation.',
      );
      return;
    }
    throw new Error(
      'Missing required Cloudflare R2 secrets: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.',
    );
  }

  const latestYmlPath = resolve(releaseDir, 'latest.yml');
  const latestYmlContent = await readFile(latestYmlPath, 'utf8').catch(() => null);
  if (!latestYmlContent) {
    throw new Error(`latest.yml not found in ${releaseDir}. Please build Windows updater first.`);
  }

  const pathMatch = latestYmlContent.match(/^path:\s*(.+)$/m);
  if (!pathMatch || !pathMatch[1]) {
    throw new Error('latest.yml does not contain valid "path" field.');
  }

  const installerFileName = pathMatch[1].trim().replace(/^['"]|['"]$/g, '');
  const blockmapFileName = `${installerFileName}.blockmap`;

  const installerPath = resolve(releaseDir, installerFileName);
  const blockmapPath = resolve(releaseDir, blockmapFileName);

  const installerBuffer = await readFile(installerPath);
  const blockmapBuffer = await readFile(blockmapPath);
  const latestYmlBuffer = Buffer.from(latestYmlContent, 'utf8');

  const installerStat = await stat(installerPath);
  const blockmapStat = await stat(blockmapPath);

  console.log(`\n📦 Local Artifacts Verified:`);
  console.log(
    `  - Installer: ${installerFileName} (${(installerStat.size / (1024 * 1024)).toFixed(2)} MB)`,
  );
  console.log(`  - Blockmap:  ${blockmapFileName} (${(blockmapStat.size / 1024).toFixed(1)} KB)`);
  console.log(`  - Manifest:  latest.yml (${latestYmlBuffer.length} bytes)`);

  const client = new R2S3Client({
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
  });

  // STEP 1: Upload Installer Executable (Immutable Cache)
  const installerKey = `${feedPrefix}/${installerFileName}`;
  console.log(
    `\n🚀 [Step 1/5] Uploading Installer binary to s3://${bucketName}/${installerKey}...`,
  );
  await client.putObject({
    key: installerKey,
    body: installerBuffer,
    contentType: 'application/vnd.microsoft.portable-executable',
    cacheControl: 'public, max-age=31536000, immutable',
  });
  console.log(
    `✔ [Step 1/5] Installer uploaded with Cache-Control: public, max-age=31536000, immutable`,
  );

  // STEP 2: Upload Blockmap (Immutable Cache)
  const blockmapKey = `${feedPrefix}/${blockmapFileName}`;
  console.log(`\n🚀 [Step 2/5] Uploading Blockmap to s3://${bucketName}/${blockmapKey}...`);
  await client.putObject({
    key: blockmapKey,
    body: blockmapBuffer,
    contentType: 'application/octet-stream',
    cacheControl: 'public, max-age=31536000, immutable',
  });
  console.log(
    `✔ [Step 2/5] Blockmap uploaded with Cache-Control: public, max-age=31536000, immutable`,
  );

  // STEP 3: Verify Remote Files via HEAD Request
  console.log(`\n🔍 [Step 3/5] Verifying remote binaries on R2...`);
  const headInstaller = await client.headObject({ key: installerKey });
  if (!headInstaller.ok) {
    throw new Error(
      `Verification failed: Remote installer ${installerKey} returned HTTP ${headInstaller.status}`,
    );
  }
  const headBlockmap = await client.headObject({ key: blockmapKey });
  if (!headBlockmap.ok) {
    throw new Error(
      `Verification failed: Remote blockmap ${blockmapKey} returned HTTP ${headBlockmap.status}`,
    );
  }
  console.log(`✔ [Step 3/5] Remote installer & blockmap verified on R2.`);

  // STEP 4: Upload latest.yml LAST (No Cache)
  const latestYmlKey = `${feedPrefix}/latest.yml`;
  console.log(
    `\n🚀 [Step 4/5] Uploading latest.yml manifest LAST to s3://${bucketName}/${latestYmlKey}...`,
  );
  await client.putObject({
    key: latestYmlKey,
    body: latestYmlBuffer,
    contentType: 'text/yaml; charset=utf-8',
    cacheControl: 'no-cache, no-store, must-revalidate',
  });
  console.log(
    `✔ [Step 4/5] latest.yml uploaded with Cache-Control: no-cache, no-store, must-revalidate`,
  );

  // STEP 5: Verify Live Feed URL via Worker
  console.log(`\n🔍 [Step 5/5] Verifying live feed endpoint via Worker URL...`);
  const liveUrl = `${workerUrl}/${feedPrefix}/latest.yml`;
  try {
    const liveRes = await fetch(liveUrl, {
      method: 'GET',
      headers: {
        'Cache-Control': 'no-cache',
        'User-Agent': 'ProPos-PrintAgent-Verifier/1.0',
      },
    });

    if (liveRes.ok) {
      const liveText = await liveRes.text();
      if (
        liveText.includes(`version: ${version}`) ||
        liveText.includes(`version: '${version}'`) ||
        liveText.includes(`version: "${version}"`)
      ) {
        console.log(
          `✔ [Step 5/5] Live Worker feed ${liveUrl} verified: HTTP 200 OK with version ${version}!`,
        );
      } else {
        console.warn(
          `⚠️ [Step 5/5] Live feed returned HTTP 200 but content did not match version ${version} yet (CDN edge propagation).`,
        );
      }
    } else {
      console.warn(
        `⚠️ [Step 5/5] Live Worker feed returned HTTP ${liveRes.status}. Ensure Worker with PRINT_AGENT_UPDATES binding is deployed.`,
      );
    }
  } catch (err) {
    console.warn(
      `⚠️ [Step 5/5] Could not reach ${liveUrl}: ${err.message}. Ensure Worker is accessible.`,
    );
  }

  console.log(
    `\n🎉 [R2Publisher] Successfully published PRO POS Print Agent v${version} updater feed to Cloudflare R2!`,
  );
}

main().catch((err) => {
  console.error(`\n❌ [R2Publisher] Publishing failed:`, err);
  process.exit(1);
});
