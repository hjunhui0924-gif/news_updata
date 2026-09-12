import { test, expect } from '@playwright/test';
test('preferences persist and a web-only brief can be generated', async ({ page }) => {
  await page.goto('/settings');
  const toggle = page.getByRole('switch', { name: '紧凑列表' });
  if ((await toggle.getAttribute('aria-checked')) === 'true') await toggle.click();
  await toggle.click();
  await page.getByRole('button', { name: '保存偏好' }).click();
  await expect(page.getByRole('status')).toHaveText('偏好已保存');
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await page.getByRole('button', { name: '保存偏好' }).click();
  await expect(page.getByRole('status')).toHaveText('偏好已保存');
  await page.getByRole('button', { name: '生成更新简报' }).click();
  await expect(page.getByRole('heading', { name: /我的更新简报/ })).toBeVisible();
  await expect(page.getByText('仅网页展示', { exact: true })).toBeVisible();
});

test('mutations reject foreign origins and do not cross user boundaries', async ({ request }) => {
  const foreign = await request.patch('/api/items/demo-item-0/state', {
    data: { saved: false },
    headers: { Origin: 'https://untrusted.example' },
  });
  expect(foreign.status()).toBe(403);
  const missing = await request.patch('/api/items/missing-other-user-item/state', {
    data: { saved: false },
    headers: { Origin: 'http://127.0.0.1:3000' },
  });
  expect(missing.status()).toBe(404);
});
