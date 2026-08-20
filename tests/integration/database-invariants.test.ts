import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('D1 schema invariants', () => {
  it('installs all migration tables and triggers', async () => {
    const objects = await env.DB.prepare(
      `SELECT name, type FROM sqlite_master
       WHERE name IN (
         'stores', 'activation_grants', 'service_tables', 'orders',
         'trg_open_table_validate', 'trg_checkout_validate'
       ) ORDER BY name`,
    ).all<{ name: string; type: string }>();
    expect(objects.results.map((row) => row.name)).toEqual([
      'activation_grants',
      'orders',
      'service_tables',
      'stores',
      'trg_checkout_validate',
      'trg_open_table_validate',
    ]);
  });

  it('seeds the permission catalog', async () => {
    const row = await env.DB.prepare('SELECT COUNT(*) AS total FROM permissions').first<{
      total: number;
    }>();
    expect(row?.total).toBeGreaterThanOrEqual(16);
  });
});
