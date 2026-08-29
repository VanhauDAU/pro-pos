import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = resolve(repositoryRoot, 'apps/print-agent/release');
const artifacts = (await readdir(releaseDir))
  .filter(
    (name) =>
      (name.endsWith('.exe') || name.endsWith('.dmg') || name.endsWith('.zip')) &&
      !name.endsWith('.blockmap'),
  )
  .toSorted();
if (artifacts.length === 0)
  throw new Error('No release artifacts (.exe, .dmg, .zip) found to checksum.');
const sums = await Promise.all(
  artifacts.map(async (name) => {
    const digest = createHash('sha256')
      .update(await readFile(resolve(releaseDir, name)))
      .digest('hex');
    return `${digest}  ${name}`;
  }),
);
await writeFile(resolve(releaseDir, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`, 'utf8');
