const { execFileSync } = require('node:child_process');
const { access } = require('node:fs/promises');
const { dirname, resolve } = require('node:path');

const pendingSignatures = new Map();

function verifySignature(appPath) {
  try {
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

async function resolveAppPath(artifactPath) {
  const artifactName = artifactPath.toLowerCase();
  const architecture = artifactName.includes('arm64') ? 'arm64' : 'x64';
  const outputDirectory = architecture === 'arm64' ? 'mac-arm64' : 'mac';
  const appPath = resolve(dirname(artifactPath), outputDirectory, 'PRO POS Print Agent.app');
  await access(appPath);
  return appPath;
}

module.exports = async function ensurePrintAgentMacosSignature(event) {
  if (process.platform !== 'darwin' || !/\.(dmg|zip)$/i.test(event.file)) return;
  const appPath = await resolveAppPath(event.file);
  if (pendingSignatures.has(appPath)) return pendingSignatures.get(appPath);

  const signature = (async () => {
    if (verifySignature(appPath)) return;
    execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', appPath], {
      stdio: 'inherit',
    });
    if (!verifySignature(appPath)) {
      throw new Error(`Ad-hoc code signature verification failed: ${appPath}`);
    }
    console.warn(
      `Applied a development-only ad-hoc signature to ${appPath}. Use a Developer ID Application identity for production distribution.`,
    );
  })();
  pendingSignatures.set(appPath, signature);
  return signature;
};
