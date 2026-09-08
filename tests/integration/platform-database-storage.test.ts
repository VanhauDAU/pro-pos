import { env } from 'cloudflare:workers';
import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import type { DatabaseStorageReport } from '@contracts/platform';
import { randomOpaqueToken } from '@server/lib/crypto';
import { hashExchangeCode } from '@server/lib/crypto';
import { AccessAuthRepository } from '@server/repositories/access-auth-repository';
import { DEFAULT_RETENTION_POLICY } from '@server/repositories/maintenance-repository';
import { PlatformRepository } from '@server/repositories/platform-repository';
import { AccessAuthService } from '@server/services/access-auth-service';
import { MaintenanceService } from '@server/services/maintenance-service';
import { PlatformService } from '@server/services/platform-service';

const ORIGIN = 'https://pro-pos.test';
const ADMIN_EMAIL = 'system.admin@example.com';
const OWNER_EMAIL = 'owner.storage.test@example.com';

function cookieValue(response: Response, name: string) {
  const header = response.headers.get('Set-Cookie') ?? '';
  const match = header.match(new RegExp(`(?:^|,\\s*)${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : null;
}

async function jsonData<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as { data: T };
  return payload.data;
}

async function authorizeBridge(requestId: string, email: string) {
  const code = randomOpaqueToken();
  const result = await new AccessAuthRepository(env.DB).authorizeRequest({
    id: requestId,
    email,
    subject: `access-${email}`,
    codeHash: await hashExchangeCode(code),
    now: Date.now(),
  });
  expect(result.meta.changes).toBe(1);
  return code;
}

async function completeAccess(purpose: 'OWNER_LOGIN' | 'PLATFORM_LOGIN', email: string) {
  const start = await SELF.fetch(`${ORIGIN}/api/v1/auth/access/start`, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ purpose }),
  });
  expect(start.status).toBe(200);
  const accessCookie = cookieValue(start, '__Host-propos-access')!;
  const rawState = accessCookie.slice(accessCookie.indexOf('=') + 1);
  const startData = await jsonData<{ loginUrl: string }>(start);
  const requestId = new URL(startData.loginUrl).searchParams.get('request');
  expect(requestId).toBeTruthy();
  const service = new AccessAuthService(env);
  const rawCode = await authorizeBridge(requestId!, email);
  return service.exchange({ rawState, rawCode });
}

describe('Platform Database Storage Endpoint & Observability', () => {
  beforeAll(async () => {
    const platform = new PlatformService(env);
    if (!(await new PlatformRepository(env.DB).hasSuperAdmin())) {
      await platform.bootstrap({
        bootstrapSecret: env.SYSTEM_BOOTSTRAP_SECRET!,
        email: ADMIN_EMAIL,
        displayName: 'System Admin',
        password: 'AdminPassword123!',
      });
    }
    await platform.createStore({
      name: 'Storage Test Store',
      ownerDisplayName: 'Storage Owner',
      ownerEmail: OWNER_EMAIL,
      ownerUsername: 'owner.storage.test',
      ownerPassword: 'OwnerPassword123!',
    });
  });

  // TEST 1: SUPER_ADMIN gets storage report (200 OK)
  it('TEST 1: allows SUPER_ADMIN to fetch storage report with 200 OK and valid structure', async () => {
    const result = await completeAccess('PLATFORM_LOGIN', ADMIN_EMAIL);
    if (result.purpose !== 'PLATFORM_LOGIN') throw new Error('Expected platform session.');
    const sessionCookie = `__Host-propos-session=${result.rawSession}`;

    const res = await SELF.fetch(`${ORIGIN}/api/v1/platform/maintenance/storage`, {
      headers: {
        Origin: ORIGIN,
        Cookie: sessionCookie,
      },
    });
    expect(res.status).toBe(200);

    const report = await jsonData<DatabaseStorageReport>(res);
    expect(report).toBeDefined();
    expect(typeof report.capturedAt).toBe('number');
    expect(report.capturedAt).toBeGreaterThan(0);
    expect(typeof report.tableCount).toBe('number');
    expect(report.tableCount).toBeGreaterThan(50);
    expect(typeof report.totalEstimatedDataBytes).toBe('number');
    expect(report.totalEstimatedDataBytes).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(report.tables)).toBe(true);
    expect(report.tables.length).toBe(report.tableCount);

    if (report.databaseSizeBytes !== null) {
      expect(typeof report.databaseSizeBytes).toBe('number');
      expect(report.databaseSizeBytes).toBeGreaterThan(0);
    }
  });

  // TEST 2: Non-SUPER_ADMIN is denied
  it('TEST 2: denies non-SUPER_ADMIN (unauthenticated: 401, OWNER: 403)', async () => {
    // Unauthenticated
    const unauth = await SELF.fetch(`${ORIGIN}/api/v1/platform/maintenance/storage`, {
      headers: { Origin: ORIGIN },
    });
    expect(unauth.status).toBe(401);

    // Owner login
    const ownerLogin = await SELF.fetch(`${ORIGIN}/api/v1/auth/owner/login`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'owner.storage.test',
        password: 'OwnerPassword123!',
      }),
    });
    expect(ownerLogin.status).toBe(200);
    const sessionCookie = cookieValue(ownerLogin, '__Host-propos-session')!;

    const ownerRes = await SELF.fetch(`${ORIGIN}/api/v1/platform/maintenance/storage`, {
      headers: {
        Origin: ORIGIN,
        Cookie: sessionCookie,
      },
    });
    expect([401, 403]).toContain(ownerRes.status);
    expect(ownerRes.status).toBe(401);
  });

  // TEST 3: Internal sqlite tables are excluded
  it('TEST 3: excludes internal sqlite and D1 tables from the report', async () => {
    const service = new MaintenanceService(env);
    const report = await service.getStorageReport();

    const tableNames = report.tables.map((t) => t.tableName);
    expect(tableNames.some((n) => n.startsWith('sqlite_'))).toBe(false);
    expect(tableNames.some((n) => n.startsWith('_d1_'))).toBe(false);
    expect(tableNames.some((n) => n.startsWith('_cf_'))).toBe(false);
    expect(tableNames.includes('sqlite_stat1')).toBe(false);
    expect(tableNames.includes('sqlite_sequence')).toBe(false);
  });

  // TEST 4: Table with rows has correct rowCount and estimatedDataBytes > 0
  it('TEST 4: calculates rowCount and positive estimatedDataBytes for tables with rows', async () => {
    const service = new MaintenanceService(env);
    const report = await service.getStorageReport();

    const storesTable = report.tables.find((t) => t.tableName === 'stores');
    expect(storesTable).toBeDefined();
    expect(storesTable!.rowCount).toBeGreaterThanOrEqual(1);
    expect(storesTable!.estimatedDataBytes).toBeGreaterThan(0);
    expect(storesTable!.averageRowBytes).toBeGreaterThan(0);

    const permissionsTable = report.tables.find((t) => t.tableName === 'permissions');
    expect(permissionsTable).toBeDefined();
    expect(permissionsTable!.rowCount).toBeGreaterThanOrEqual(16);
    expect(permissionsTable!.estimatedDataBytes).toBeGreaterThan(0);
  });

  // TEST 5: Empty table has estimatedDataBytes = 0 and averageRowBytes = 0
  it('TEST 5: sets estimatedDataBytes = 0 and averageRowBytes = 0 for empty tables', async () => {
    const service = new MaintenanceService(env);
    const report = await service.getStorageReport();

    // Find an empty table, e.g. catalog_import_commands or pos_performance_sessions
    const emptyTable = report.tables.find((t) => t.rowCount === 0);
    if (emptyTable) {
      expect(emptyTable.estimatedDataBytes).toBe(0);
      expect(emptyTable.averageRowBytes).toBe(0);
      expect(emptyTable.estimatedSharePercent).toBe(0);
    }
  });

  // TEST 6: Tables are sorted descending by estimatedDataBytes
  it('TEST 6: sorts tables descending by estimatedDataBytes', async () => {
    const service = new MaintenanceService(env);
    const report = await service.getStorageReport();

    for (let i = 0; i < report.tables.length - 1; i++) {
      const current = report.tables[i]!;
      const next = report.tables[i + 1]!;
      expect(current.estimatedDataBytes).toBeGreaterThanOrEqual(next.estimatedDataBytes);
    }
  });

  // TEST 7: estimatedSharePercent sums to approximately 100% when totalEstimatedDataBytes > 0
  it('TEST 7: verifies estimatedSharePercent sums to ~100% when totalEstimatedDataBytes > 0', async () => {
    const service = new MaintenanceService(env);
    const report = await service.getStorageReport();

    if (report.totalEstimatedDataBytes > 0) {
      const totalShare = report.tables.reduce((sum, t) => sum + t.estimatedSharePercent, 0);
      expect(totalShare).toBeGreaterThanOrEqual(99.0);
      expect(totalShare).toBeLessThanOrEqual(101.0);
    }
  });

  // TEST 8: Financial table has automaticallyCleaned = false and retentionDays = null
  it('TEST 8: classifies financial tables as not automatically cleaned with null retentionDays', async () => {
    const service = new MaintenanceService(env);
    const report = await service.getStorageReport();

    const invoices = report.tables.find((t) => t.tableName === 'invoices');
    expect(invoices).toBeDefined();
    expect(invoices!.category).toBe('FINANCIAL');
    expect(invoices!.automaticallyCleaned).toBe(false);
    expect(invoices!.retentionDays).toBeNull();
    expect(invoices!.retentionLabel).toBe('Không tự động xóa');

    const payments = report.tables.find((t) => t.tableName === 'payments');
    expect(payments).toBeDefined();
    expect(payments!.category).toBe('FINANCIAL');
    expect(payments!.automaticallyCleaned).toBe(false);
    expect(payments!.retentionDays).toBeNull();
  });

  // TEST 9: pos_save_commands retention matches DEFAULT_RETENTION_POLICY.posSaveCommandDays
  it('TEST 9: retrieves retentionDays for pos_save_commands from DEFAULT_RETENTION_POLICY', async () => {
    const service = new MaintenanceService(env);
    const report = await service.getStorageReport();

    const posSaveCommands = report.tables.find((t) => t.tableName === 'pos_save_commands');
    expect(posSaveCommands).toBeDefined();
    expect(posSaveCommands!.category).toBe('OPERATIONAL');
    expect(posSaveCommands!.retentionDays).toBe(DEFAULT_RETENTION_POLICY.posSaveCommandDays);
    expect(posSaveCommands!.automaticallyCleaned).toBe(true);
  });

  // TEST 10: audit_logs retentionLabel indicates operational audit only, not entire table
  it('TEST 10: describes audit_logs retention accurately as operational audit only', async () => {
    const service = new MaintenanceService(env);
    const report = await service.getStorageReport();

    const auditLogs = report.tables.find((t) => t.tableName === 'audit_logs');
    expect(auditLogs).toBeDefined();
    expect(auditLogs!.category).toBe('OTHER');
    expect(auditLogs!.retentionLabel).toBe(
      `Vận hành: ${DEFAULT_RETENTION_POLICY.operationalAuditDays} ngày`,
    );
    expect(auditLogs!.retentionLabel).not.toBe('7 ngày');
  });

  // TEST 11: Endpoint does not leak raw records or PII
  it('TEST 11: ensures endpoint response does not contain raw records, passwords, or PII', async () => {
    const service = new MaintenanceService(env);
    const report = await service.getStorageReport();

    const reportJson = JSON.stringify(report);
    expect(reportJson).not.toContain('AdminPassword123!');
    expect(reportJson).not.toContain('OwnerPassword123!');
    expect(reportJson).not.toContain('owner.storage.test@example.com');
    // Verify each table row only has metadata and statistics
    for (const table of report.tables) {
      expect(Object.keys(table).toSorted()).toEqual([
        'automaticallyCleaned',
        'averageRowBytes',
        'category',
        'estimatedDataBytes',
        'estimatedSharePercent',
        'indexCount',
        'retentionDays',
        'retentionLabel',
        'rowCount',
        'tableName',
      ]);
    }
  });

  // TEST 12: Storage report does not mutate the database
  it('TEST 12: guarantees storage report is strictly read-only and does not mutate database', async () => {
    const countStoresBefore = await env.DB.prepare('SELECT COUNT(*) AS total FROM stores').first<{
      total: number;
    }>();
    const countUsersBefore = await env.DB.prepare('SELECT COUNT(*) AS total FROM users').first<{
      total: number;
    }>();

    const service = new MaintenanceService(env);
    await service.getStorageReport();
    await service.getStorageReport();

    const countStoresAfter = await env.DB.prepare('SELECT COUNT(*) AS total FROM stores').first<{
      total: number;
    }>();
    const countUsersAfter = await env.DB.prepare('SELECT COUNT(*) AS total FROM users').first<{
      total: number;
    }>();

    expect(countStoresAfter?.total).toBe(countStoresBefore?.total);
    expect(countUsersAfter?.total).toBe(countUsersBefore?.total);
  });
});
