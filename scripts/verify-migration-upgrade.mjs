import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url);
const tempDirectory = await mkdtemp(join(tmpdir(), 'pro-pos-migration-'));
const databasePath = join(tempDirectory, 'upgrade.sqlite');

const migrationFiles = [
  '0001_identity_and_access.sql',
  '0002_catalog_and_pricing.sql',
  '0003_pos_and_billing.sql',
  '0004_access_otp_and_pin_verifiers.sql',
  '0005_access_bridge_codes.sql',
  '0006_security_tenant_financial_hardening.sql',
  '0007_owner_store_location.sql',
  '0008_area_table_setup.sql',
  '0009_staff_roles_permissions.sql',
  '0010_staff_pos_orders.sql',
  '0011_pos_order_lifecycle.sql',
  '0012_compact_pos_codes.sql',
  '0013_adjust_time_session.sql',
];

const fixture = `
PRAGMA foreign_keys = ON;
INSERT INTO stores (id, name, status, timezone, created_at, updated_at)
VALUES ('store-upgrade', 'Upgrade Store', 'ACTIVE', 'Asia/Ho_Chi_Minh', 1, 1);
INSERT INTO users (id, username, email, display_name, status, created_at, updated_at)
VALUES ('owner-upgrade', 'owner-upgrade', 'owner-upgrade@example.com', 'Upgrade Owner', 'ACTIVE', 1, 1);
INSERT INTO roles (id, store_id, code, name, is_system, created_at, updated_at)
VALUES ('role-owner-upgrade', 'store-upgrade', 'OWNER', 'Owner', 1, 1, 1);
INSERT INTO store_memberships (id, store_id, user_id, role_id, status, created_at, updated_at)
VALUES ('membership-upgrade', 'store-upgrade', 'owner-upgrade', 'role-owner-upgrade', 'ACTIVE', 1, 1);
INSERT INTO store_settings (store_id, updated_at) VALUES ('store-upgrade', 1);
INSERT INTO areas (id, store_id, name, created_at, updated_at)
VALUES ('area-upgrade', 'store-upgrade', 'Area', 1, 1);
INSERT INTO products (id, store_id, name, product_type, status, created_at, updated_at)
VALUES ('product-upgrade', 'store-upgrade', 'Product', 'QUANTITY', 'ACTIVE', 1, 1);
INSERT INTO product_variants (
  id, store_id, product_id, display_code, name, sale_price, cost_price, prompt_price,
  status, created_at, updated_at
)
VALUES ('variant-upgrade', 'store-upgrade', 'product-upgrade', 'UPGRADE-1', 'Default', 100000, 0, 0, 'ACTIVE', 1, 1);
INSERT INTO service_tables (
  id, store_id, area_id, time_product_id, name, status, version, created_at, updated_at
)
VALUES ('table-upgrade', 'store-upgrade', 'area-upgrade', 'product-upgrade', 'Table', 'AVAILABLE', 1, 1, 1);
INSERT INTO orders (
  id, store_id, table_id, status, version, opened_by, opened_at, created_at, updated_at
)
VALUES ('order-upgrade', 'store-upgrade', 'table-upgrade', 'PAID', 2, 'owner-upgrade', 1, 1, 1);
INSERT INTO order_items (
  id, store_id, order_id, product_id, variant_id, product_type,
  product_name_snapshot, variant_name_snapshot, unit_price_snapshot, quantity_milli,
  discount_type, discount_value, line_total, added_by, created_at, updated_at
)
VALUES (
  'item-upgrade', 'store-upgrade', 'order-upgrade', 'product-upgrade', 'variant-upgrade', 'QUANTITY',
  'Product', 'Default', 100000, 1000, 'FIXED', 120000, 0, 'owner-upgrade', 1, 1
);
INSERT INTO invoices (
  id, store_id, order_id, display_code, subtotal, discount_total, total,
  status, issued_at, issued_by, snapshot_json
)
VALUES ('invoice-upgrade', 'store-upgrade', 'order-upgrade', 'LEGACY-1', 0, 0, 0, 'COMPLETED', 1, 'owner-upgrade', '{}');
INSERT INTO invoice_lines (
  id, store_id, invoice_id, line_type, description, quantity_milli,
  unit_price, discount_amount, line_total, snapshot_json
)
VALUES ('line-upgrade', 'store-upgrade', 'invoice-upgrade', 'PRODUCT', 'Product', 1000, 100000, 120000, 0, '{}');
`;

try {
  const migrations = await Promise.all(
    migrationFiles.map(async (file) => readFile(new URL(`migrations/${file}`, root), 'utf8')),
  );
  const sql = `${migrations.slice(0, 5).join('\n')}\n${fixture}\n${migrations.slice(5).join('\n')}`;
  const result = spawnSync('sqlite3', ['-batch', '-noheader', '-separator', '|', databasePath], {
    input: `${sql}\nSELECT gross_line_total, discount_amount, net_line_total FROM order_items WHERE id = 'item-upgrade';\nSELECT gross_line_total, discount_amount, line_total FROM invoice_lines WHERE id = 'line-upgrade';\n`,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'sqlite3 migration execution failed');
  }
  const rows = result.stdout.trim().split('\n');
  const expected = ['100000|100000|0', '100000|100000|0'];
  if (rows.at(-2) !== expected[0] || rows.at(-1) !== expected[1]) {
    throw new Error(`Unexpected 0005 → 0013 backfill: ${rows.slice(-2).join(', ')}`);
  }
  console.log(
    '0005 → 0013 upgrade path passed: accounting, POS lifecycle, compact codes and time corrections are safe.',
  );
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}
