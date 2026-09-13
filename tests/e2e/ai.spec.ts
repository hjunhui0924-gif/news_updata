import { test, expect } from '@playwright/test';
test('on-demand demo translation completes through the worker', async ({ page }) => {
  await page.goto('/items/demo-item-1');
  await page.getByRole('tab', { name: '对照翻译' }).click();
  if (await page.getByRole('button', { name: '生成中文翻译', exact: true }).count())
    await page.getByRole('button', { name: '生成中文翻译', exact: true }).click();
  await expect(page.getByText('演示译文：预先编写的体验样本', { exact: false })).toBeVisible({
    timeout: 20000,
  });
  await page.reload();
  await page.getByRole('tab', { name: '对照翻译' }).click();
  await expect(page.getByText('演示译文：预先编写的体验样本', { exact: false })).toBeVisible();
});
