import { execFileSync, spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = resolve(repositoryRoot, 'apps/print-agent/release');
const requestedArchitectures = process.argv.slice(2).filter((value) => value !== '--');
const architectures = requestedArchitectures.length > 0 ? requestedArchitectures : ['arm64', 'x64'];
const expected = {
  arm64: resolve(releaseDir, 'mac-arm64/PRO POS Print Agent.app/Contents/Info.plist'),
  x64: resolve(releaseDir, 'mac/PRO POS Print Agent.app/Contents/Info.plist'),
};
const expectedBundleId = 'com.propos.print-agent';
const expectedUsageDescription =
  'PRO POS Print Agent cần truy cập mạng nội bộ để kết nối và gửi dữ liệu tới máy in hóa đơn trong cửa hàng.';

function readPlistValue(plistPath, key) {
  return execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plistPath], {
    encoding: 'utf8',
  }).trim();
}

function verifyCodeIdentity(appPath) {
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath]);
  const result = spawnSync('/usr/bin/codesign', ['-dvvv', appPath], {
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr || `Unable to inspect ${appPath}`);
  return result.stderr;
}

for (const architecture of architectures) {
  const plistPath = expected[architecture];
  if (!plistPath) throw new Error(`Unsupported macOS architecture: ${architecture}`);
  await access(plistPath);
  const bundleId = readPlistValue(plistPath, 'CFBundleIdentifier');
  const usageDescription = readPlistValue(plistPath, 'NSLocalNetworkUsageDescription');
  if (bundleId !== expectedBundleId) {
    throw new Error(`Unexpected CFBundleIdentifier in ${plistPath}: ${bundleId}`);
  }
  if (usageDescription !== expectedUsageDescription) {
    throw new Error(`Unexpected NSLocalNetworkUsageDescription in ${plistPath}`);
  }
  const appPath = resolve(dirname(plistPath), '..');
  const signatureDetails = verifyCodeIdentity(appPath);
  if (!signatureDetails.includes(`Identifier=${expectedBundleId}`)) {
    throw new Error(`Unexpected code-signing identifier in ${appPath}`);
  }
  const executablePath = resolve(appPath, 'Contents/MacOS/PRO POS Print Agent');
  const uuid = execFileSync('/usr/bin/dwarfdump', ['--uuid', executablePath], {
    encoding: 'utf8',
  }).trim();
  if (!uuid.startsWith('UUID:')) throw new Error(`Missing Mach-O UUID in ${executablePath}`);
  const signatureType = signatureDetails.includes('TeamIdentifier=not set')
    ? 'ad-hoc development signature'
    : 'Apple-issued signature';
  console.log(`Verified ${architecture} app: ${bundleId}; ${signatureType}; ${uuid}`);
}
