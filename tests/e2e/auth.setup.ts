import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const authStatePath = 'playwright/.auth/pos.json';

function required(...names: string[]) {
  const value = names.map((name) => process.env[name]).find(Boolean);
  if (!value) {
    throw new Error(
      `Missing ${names.join(' or ')}. Authenticated E2E requires dedicated staging credentials; see tests/e2e/README.md.`,
    );
  }
  return value;
}

test('authenticate a dedicated POS employee and persist browser state', async ({ page }) => {
  const ownerUsername = required('E2E_OWNER_USERNAME', 'E2E_USERNAME');
  const ownerPassword = required('E2E_OWNER_PASSWORD', 'E2E_PASSWORD');
  const employeeUsername = required('E2E_POS_USERNAME');
  const employeePin = required('E2E_POS_PIN');
  if (!/^\d{4}$/.test(employeePin))
    throw new Error('E2E_POS_PIN must contain exactly four digits.');

  // A fresh browser context has no device cookie. Device activation is part of
  // setup instead of persisting a secret storage state between runs.
  await page.goto('/device-activation');
  await page.getByPlaceholder('Tên đăng nhập hoặc Email').fill(ownerUsername);
  await page.getByPlaceholder('Mật khẩu Owner').fill(ownerPassword);
  await page
    .getByPlaceholder('Ví dụ: Máy thu ngân chính')
    .fill(process.env['E2E_DEVICE_NAME'] ?? `Playwright E2E ${process.env['CI'] ? 'CI' : 'local'}`);
  await page.getByRole('button', { name: 'Kích hoạt máy POS' }).click();

  await expect(page).toHaveURL(/\/?tab=employee/);
  await page.getByPlaceholder('Tên đăng nhập').fill(employeeUsername);
  await page.getByLabel('Mã PIN 4 số').fill(employeePin);
  await expect(page).toHaveURL(/\/pos(?:\/|$)/, { timeout: 15_000 });

  await page.goto('/pos/areas');
  await expect(page).toHaveURL(/\/pos\/areas/);
  await expect(page.getByLabel('Trạng thái kết nối')).toContainText('Trực tiếp', {
    timeout: 20_000,
  });

  mkdirSync(dirname(authStatePath), { recursive: true });
  await page.context().storageState({ path: authStatePath });
});
