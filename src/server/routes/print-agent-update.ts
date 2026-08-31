import { Hono } from 'hono';

import type { AppEnv } from '@server/types';

const printAgentUpdateRoutes = new Hono<AppEnv>();

// Whitelist of valid filename pattern for print agent updater artifacts
const VALID_FILENAME_PATTERN = /^[a-zA-Z0-9_\-. ]+\.(exe|blockmap|yml|yaml|json|txt)$/i;

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

  const key = `print-agent/windows/stable/${decodedFilename}`;
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
