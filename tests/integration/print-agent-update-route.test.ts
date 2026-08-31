import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';

import { printAgentUpdateRoutes } from '@server/routes/print-agent-update';

describe('Print Agent Worker Update Route (Integration Test)', () => {
  const sampleManifest = `version: 0.5.2
files:
  - url: PRO POS Print Agent Setup 0.5.2.exe
    sha512: dGVzdC1zaGE1MTItY2hlY2tzdW0=
    size: 95536000
    blockMapSize: 102400
path: PRO POS Print Agent Setup 0.5.2.exe
sha512: dGVzdC1zaGE1MTItY2hlY2tzdW0=
releaseDate: '2026-08-31T06:00:00.000Z'
`;

  const sampleExeBuffer = Buffer.from('MOCK-WINDOWS-EXE-BINARY-HEADER-AND-DATA');
  const sampleBlockmapBuffer = Buffer.from('MOCK-BLOCKMAP-XML-DATA');

  beforeAll(async () => {
    // Populate mock R2 bucket
    await env.PRINT_AGENT_UPDATES.put('print-agent/windows/stable/latest.yml', sampleManifest, {
      httpMetadata: {
        contentType: 'text/yaml; charset=utf-8',
      },
    });

    await env.PRINT_AGENT_UPDATES.put(
      'print-agent/windows/stable/PRO POS Print Agent Setup 0.5.2.exe',
      sampleExeBuffer,
      {
        httpMetadata: {
          contentType: 'application/vnd.microsoft.portable-executable',
        },
      },
    );

    await env.PRINT_AGENT_UPDATES.put(
      'print-agent/windows/stable/PRO POS Print Agent Setup 0.5.2.exe.blockmap',
      sampleBlockmapBuffer,
      {
        httpMetadata: {
          contentType: 'application/octet-stream',
        },
      },
    );
  });

  it('serves latest.yml with HTTP 200, text/yaml, and Cache-Control: no-cache', async () => {
    const res = await printAgentUpdateRoutes.request('/latest.yml', { method: 'GET' }, env);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/yaml; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(res.headers.get('ETag')).toBeDefined();

    const body = await res.text();
    expect(body).toBe(sampleManifest);
  });

  it('handles HEAD request for latest.yml without body', async () => {
    const res = await printAgentUpdateRoutes.request('/latest.yml', { method: 'HEAD' }, env);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/yaml; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(res.headers.get('Content-Length')).toBe(String(sampleManifest.length));

    const body = await res.text();
    expect(body).toBe('');
  });

  it('serves .exe installer binary with HTTP 200, immutable cache, and correct Content-Type', async () => {
    const res = await printAgentUpdateRoutes.request(
      '/PRO%20POS%20Print%20Agent%20Setup%200.5.2.exe',
      { method: 'GET' },
      env,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/vnd.microsoft.portable-executable');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('Content-Length')).toBe(String(sampleExeBuffer.length));

    const arrayBuffer = await res.arrayBuffer();
    expect(Buffer.from(arrayBuffer)).toEqual(sampleExeBuffer);
  });

  it('serves .blockmap with HTTP 200, immutable cache, and correct Content-Type', async () => {
    const res = await printAgentUpdateRoutes.request(
      '/PRO%20POS%20Print%20Agent%20Setup%200.5.2.exe.blockmap',
      { method: 'GET' },
      env,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('Content-Length')).toBe(String(sampleBlockmapBuffer.length));

    const arrayBuffer = await res.arrayBuffer();
    expect(Buffer.from(arrayBuffer)).toEqual(sampleBlockmapBuffer);
  });

  it('returns HTTP 404 for non-existent file', async () => {
    const res = await printAgentUpdateRoutes.request(
      '/PRO%20POS%20Print%20Agent%20Setup%209.9.9.exe',
      { method: 'GET' },
      env,
    );

    expect(res.status).toBe(404);
  });

  it('blocks path traversal attempts (../, invalid extensions)', async () => {
    const traversalTests = [
      '/..%2fsecret.txt',
      '/..%5csecret.txt',
      '/nested%2fhack.exe',
      '/script.php',
      '/config.env',
    ];

    for (const path of traversalTests) {
      const res = await printAgentUpdateRoutes.request(path, { method: 'GET' }, env);

      expect(res.status).toBe(403);
    }
  });

  it('is completely public without requiring auth headers, session cookies, or CSRF tokens', async () => {
    const res = await printAgentUpdateRoutes.request(
      '/latest.yml',
      {
        method: 'GET',
        headers: {}, // No cookies, no auth
      },
      env,
    );

    expect(res.status).toBe(200);
  });
});
