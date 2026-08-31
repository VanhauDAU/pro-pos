import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJsonPath = resolve(repositoryRoot, 'apps/print-agent/package.json');
const releaseDir = resolve(repositoryRoot, 'apps/print-agent/release');

const pkg = JSON.parse(await readFile(packageJsonPath, 'utf8'));
const packageVersion = pkg.version;

console.log(`[VerifyUpdater] Verifying update artifacts for version ${packageVersion}...`);

const files = await readdir(releaseDir).catch(() => []);
if (files.length === 0) {
  throw new Error(`Release directory is empty or missing: ${releaseDir}`);
}

// 1. Check latest.yml exists
if (!files.includes('latest.yml')) {
  throw new Error(
    `latest.yml is missing in ${releaseDir}. Make sure electron-builder was executed with generic publish configured.`,
  );
}

const latestYmlContent = await readFile(resolve(releaseDir, 'latest.yml'), 'utf8');

// Parse basic YAML fields
const versionMatch = latestYmlContent.match(/^version:\s*(.+)$/m);
const pathMatch = latestYmlContent.match(/^path:\s*(.+)$/m);
const sha512Match = latestYmlContent.match(/^sha512:\s*(.+)$/m);

if (!versionMatch || !versionMatch[1]) {
  throw new Error('latest.yml is missing "version" field.');
}

const latestVersion = versionMatch[1].trim().replace(/^['"]|['"]$/g, '');
if (latestVersion !== packageVersion) {
  throw new Error(
    `Version mismatch in latest.yml: expected "${packageVersion}", found "${latestVersion}".`,
  );
}

// Ensure portable is NOT referenced in latest.yml
if (/portable/i.test(latestYmlContent)) {
  throw new Error('latest.yml must NOT reference Portable executable artifacts.');
}

// 2. Identify installer binary
const targetInstallerName = pathMatch ? pathMatch[1].trim().replace(/^['"]|['"]$/g, '') : null;
const installerFile =
  targetInstallerName ||
  files.find((f) => f.endsWith('.exe') && !f.includes('Portable') && !f.endsWith('.blockmap'));

if (!installerFile || !files.includes(installerFile)) {
  throw new Error(
    `Installer binary "${installerFile}" specified in latest.yml does not exist in release directory.`,
  );
}

const installerPath = resolve(releaseDir, installerFile);
const installerStat = await stat(installerPath);

// Minimum 20MB check
const minSizeBytes = 20 * 1024 * 1024;
if (installerStat.size < minSizeBytes) {
  throw new Error(
    `Installer "${installerFile}" is suspiciously small (${(installerStat.size / (1024 * 1024)).toFixed(2)} MB). Minimum expected: 20 MB.`,
  );
}

// 3. Check blockmap exists
const blockmapFile = `${installerFile}.blockmap`;
if (!files.includes(blockmapFile)) {
  throw new Error(`Blockmap file "${blockmapFile}" is missing in release directory.`);
}

// 4. Verify SHA512 checksum between binary and latest.yml
const installerBuffer = await readFile(installerPath);
const actualSha512Base64 = createHash('sha512').update(installerBuffer).digest('base64');
const expectedSha512 = sha512Match ? sha512Match[1].trim().replace(/^['"]|['"]$/g, '') : null;

if (expectedSha512 && expectedSha512 !== actualSha512Base64) {
  throw new Error(
    `SHA512 checksum mismatch for "${installerFile}":\n  latest.yml: ${expectedSha512}\n  calculated: ${actualSha512Base64}`,
  );
}

console.log(`✔ [VerifyUpdater] Artifact verification passed successfully for v${packageVersion}:`);
console.log(
  `  - Installer: ${installerFile} (${(installerStat.size / (1024 * 1024)).toFixed(2)} MB)`,
);
console.log(`  - Blockmap:  ${blockmapFile}`);
console.log(`  - Manifest:  latest.yml (v${latestVersion})`);
console.log(`  - SHA512:    ${actualSha512Base64.slice(0, 24)}... (verified)`);
