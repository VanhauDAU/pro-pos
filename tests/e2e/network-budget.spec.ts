import { expect, test } from '@playwright/test';

test('login shell stays split and does not request audio', async ({ page }) => {
  const requestedUrls: string[] = [];
  page.on('request', (request) => requestedUrls.push(request.url()));
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  expect(requestedUrls.some((url) => /\/sound\/|\.(?:mp3|ogg|wav)(?:\?|$)/iu.test(url))).toBe(
    false,
  );
  expect(requestedUrls.some((url) => url.includes('StaffPosPortalPage-'))).toBe(false);
  expect(requestedUrls.some((url) => url.includes('OwnerPortalPage-'))).toBe(false);
});

test('connected POS is idle without Fetch/XHR polling', async ({ page }) => {
  test.skip(!process.env['PROPOS_E2E_STORAGE_STATE'], 'Requires authenticated POS storage state.');
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (['fetch', 'xhr'].includes(request.resourceType()) && request.url().includes('/api/')) {
      apiRequests.push(request.url());
    }
  });
  await page.goto('/pos/areas');
  await expect(page.getByLabel('Trạng thái kết nối')).toContainText('Trực tiếp');
  apiRequests.length = 0;
  await page.waitForTimeout(15_000);
  expect(apiRequests).toEqual([]);
});
