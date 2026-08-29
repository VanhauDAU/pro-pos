import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceHtml = resolve(repositoryRoot, 'apps/print-agent/src/desktop/renderer/index.html');
const targetHtml = resolve(repositoryRoot, 'apps/print-agent/dist/desktop/renderer/index.html');
await mkdir(dirname(targetHtml), { recursive: true });
await cp(sourceHtml, targetHtml);

const sourceIcon = resolve(repositoryRoot, 'apps/print-agent/build/icon.png');
const targetIcon = resolve(repositoryRoot, 'apps/print-agent/dist/desktop/renderer/icon.png');
await cp(sourceIcon, targetIcon);
