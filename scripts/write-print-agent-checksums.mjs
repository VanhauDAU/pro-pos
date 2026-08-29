import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const releaseDir = resolve('apps/print-agent/release');
const artifacts = (await readdir(releaseDir)).filter((name) => name.endsWith('.exe')).sort();
const sums = await Promise.all(artifacts.map(async (name) => {
  const digest = createHash('sha256').update(await readFile(resolve(releaseDir, name))).digest('hex');
  return `${digest}  ${name}`;
}));
await writeFile(resolve(releaseDir, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`, 'utf8');
