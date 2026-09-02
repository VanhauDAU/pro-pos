import { readFile, readdir, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const clientRoot = path.resolve('dist/client');
const manifestPath = path.join(clientRoot, '.vite/manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

const targets = {
  posCriticalJsGzip: 300 * 1024,
  criticalCssGzip: 45 * 1024,
  precacheBytes: 1.4 * 1024 * 1024,
  criticalChunks: 30,
};
const regressionCeilings = {
  posCriticalJsGzip: 580 * 1024,
  criticalCssGzip: 70 * 1024,
  precacheBytes: targets.precacheBytes,
  criticalChunks: 55,
};
const budgets = process.env.PERF_BUDGET_STRICT === 'true' ? targets : regressionCeilings;

const entryKey = Object.keys(manifest).find((key) => manifest[key].isEntry);
const posKey = Object.keys(manifest).find((key) => key.endsWith('/StaffPosAreasPage.tsx'));
if (!entryKey || !posKey) throw new Error('Could not resolve entry/POS chunks from Vite manifest.');

function collectImports(key, output = new Set()) {
  if (output.has(key)) return output;
  output.add(key);
  for (const imported of manifest[key]?.imports ?? []) collectImports(imported, output);
  return output;
}

const criticalKeys = collectImports(posKey, collectImports(entryKey));
const criticalFiles = [...criticalKeys]
  .map((key) => manifest[key]?.file)
  .filter((file) => typeof file === 'string' && file.endsWith('.js'));
const cssFiles = new Set(
  [...criticalKeys]
    .flatMap((key) => manifest[key]?.css ?? [])
    .filter((file) => file.endsWith('.css')),
);

async function gzipBytes(files) {
  let total = 0;
  for (const file of files)
    total += gzipSync(await readFile(path.join(clientRoot, file))).byteLength;
  return total;
}

const sw = await readFile(path.join(clientRoot, 'sw.js'), 'utf8');
const precacheUrls = [...sw.matchAll(/["']url["']:\s*["']([^"']+)["']/gu)].map((match) => match[1]);
let precacheBytes = 0;
for (const url of new Set(precacheUrls)) {
  const file = path.join(clientRoot, url.replace(/^\//u, ''));
  try {
    precacheBytes += (await stat(file)).size;
  } catch {
    // Workbox can include URLs not materialized as local files.
  }
}

const result = {
  posCriticalJsGzip: await gzipBytes(criticalFiles),
  criticalCssGzip: await gzipBytes(cssFiles),
  precacheBytes,
  criticalChunks: criticalFiles.length,
};
const failures = Object.entries(result).filter(([name, value]) => value > budgets[name]);

console.table(
  Object.entries(result).map(([name, value]) => ({
    metric: name,
    actual: value,
    budget: budgets[name],
    pass: value <= budgets[name],
  })),
);
if (process.env.PERF_BUDGET_STRICT !== 'true') {
  const targetGaps = Object.entries(result).filter(([name, value]) => value > targets[name]);
  if (targetGaps.length > 0) {
    console.warn(
      `Optimization targets still open: ${targetGaps.map(([name]) => name).join(', ')}. ` +
        'Regression ceilings remain enforced; use PERF_BUDGET_STRICT=true for the release target gate.',
    );
  }
}
if (failures.length > 0) {
  throw new Error(`Performance budget exceeded: ${failures.map(([name]) => name).join(', ')}`);
}

// Ensure the build output does not silently accumulate an excessive number of files.
const assetCount = (await readdir(path.join(clientRoot, 'assets'))).length;
if (assetCount > 180) throw new Error(`Asset count ${assetCount} exceeds the safety limit of 180.`);
