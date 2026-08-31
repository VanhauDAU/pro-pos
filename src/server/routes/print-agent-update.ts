import { Hono } from 'hono';

import type { AppEnv } from '@server/types';

const printAgentUpdateRoutes = new Hono<AppEnv>();

const WINDOWS_STABLE_PREFIX = 'print-agent/windows/stable';
const WINDOWS_STABLE_MANIFEST_KEY = `${WINDOWS_STABLE_PREFIX}/latest.yml`;
const WINDOWS_STABLE_DOWNLOAD_PATH = '/api/v1/print-agent-updates/windows/stable';

// Whitelist of valid filename pattern for print agent updater artifacts
const VALID_FILENAME_PATTERN = /^[a-zA-Z0-9_\-. ]+\.(exe|blockmap|yml|yaml|json|txt)$/i;

function parseInstallerFilename(manifest: string): string | null {
  const pathLines = [...manifest.matchAll(/^path:[ \t]*(.*?)[ \t]*$/gm)];
  if (pathLines.length !== 1) return null;

  let filename = pathLines[0]?.[1]?.trim() ?? '';
  if (
    filename.length >= 2 &&
    ((filename.startsWith('"') && filename.endsWith('"')) ||
      (filename.startsWith("'") && filename.endsWith("'")))
  ) {
    filename = filename.slice(1, -1);
  }

  if (
    !filename ||
    filename.includes('..') ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('\0') ||
    !filename.toLowerCase().endsWith('.exe') ||
    !VALID_FILENAME_PATTERN.test(filename)
  ) {
    return null;
  }

  return filename;
}

// Keep this route before /:filename so "download" can never be consumed as
// a generic artifact filename when the router is mounted at /windows.
printAgentUpdateRoutes.get('/download', async (c) => {
  c.header('Cache-Control', 'no-store');

  const r2Bucket = c.env.PRINT_AGENT_UPDATES;
  if (!r2Bucket) {
    return c.text('Print agent update storage not configured', 503);
  }

  let manifestObject: R2ObjectBody | null;
  try {
    manifestObject = await r2Bucket.get(WINDOWS_STABLE_MANIFEST_KEY);
  } catch {
    return c.text('Print agent update storage unavailable', 503);
  }
  if (!manifestObject) {
    return c.text('Not Found', 404);
  }

  let installerFilename: string | null;
  try {
    installerFilename = parseInstallerFilename(await manifestObject.text());
  } catch {
    return c.text('Print agent update manifest unavailable', 503);
  }
  if (!installerFilename) {
    return c.text('Invalid print agent update manifest', 500);
  }

  try {
    const installer = await r2Bucket.head(`${WINDOWS_STABLE_PREFIX}/${installerFilename}`);
    if (!installer) {
      return c.text('Not Found', 404);
    }
  } catch {
    return c.text('Print agent update storage unavailable', 503);
  }

  return c.redirect(
    `${WINDOWS_STABLE_DOWNLOAD_PATH}/${encodeURIComponent(installerFilename)}`,
    302,
  );
});

printAgentUpdateRoutes.on(['GET', 'HEAD'], '/:filename', async (c) => {
  const rawFilename = c.req.param('filename');
  if (!rawFilename) {
    return c.text('Not Found', 404);
  }

  let decodedFilename: string;
  try {
    decodedFilename = decodeURIComponent(rawFilename);
  } catch {
    return c.text('Bad Request', 400);
  }

  // Path traversal and strict safety checks
  if (
    decodedFilename.includes('..') ||
    decodedFilename.includes('/') ||
    decodedFilename.includes('\\') ||
    decodedFilename.includes('\0') ||
    !VALID_FILENAME_PATTERN.test(decodedFilename)
  ) {
    return c.text('Forbidden: Invalid file path', 403);
  }

  const r2Bucket = c.env.PRINT_AGENT_UPDATES;
  if (!r2Bucket) {
    return c.text('Print agent update storage not configured', 503);
  }

  const key = `${WINDOWS_STABLE_PREFIX}/${decodedFilename}`;
  const object = await r2Bucket.get(key);

  if (!object) {
    return c.text('Not Found', 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);

  if (object.httpEtag) {
    headers.set('ETag', object.httpEtag);
  } else if (object.etag) {
    headers.set('ETag', `"${object.etag}"`);
  }

  headers.set('Content-Length', String(object.size));

  // Custom Content-Type and Cache-Control headers
  const lowerName = decodedFilename.toLowerCase();
  if (lowerName === 'latest.yml' || lowerName.endsWith('.yml') || lowerName.endsWith('.yaml')) {
    headers.set('Content-Type', 'text/yaml; charset=utf-8');
    headers.set('Cache-Control', 'no-cache');
  } else if (lowerName.endsWith('.exe')) {
    headers.set('Content-Type', 'application/vnd.microsoft.portable-executable');
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (lowerName.endsWith('.blockmap')) {
    headers.set('Content-Type', 'application/octet-stream');
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (lowerName.endsWith('.txt')) {
    headers.set('Content-Type', 'text/plain; charset=utf-8');
    headers.set('Cache-Control', 'no-cache');
  }

  if (c.req.method === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }

  return new Response(object.body, { status: 200, headers });
});

export { printAgentUpdateRoutes };
