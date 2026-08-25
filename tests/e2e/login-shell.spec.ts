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
