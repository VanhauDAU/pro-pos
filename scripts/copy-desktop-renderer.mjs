import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(repositoryRoot, 'apps/print-agent/src/desktop/renderer/index.html');
const target = resolve(repositoryRoot, 'apps/print-agent/dist/desktop/renderer/index.html');
await mkdir(dirname(target), { recursive: true });
await cp(source, target);
