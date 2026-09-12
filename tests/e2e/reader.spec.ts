import { test, expect } from '@playwright/test';

test('direct detail links persist read state and missing items show 404', async ({
  page,
  request,
}) => {
  await request.patch('/api/items/demo-item-1/state', {
    headers: { Origin: 'http://127.0.0.1:3000' },
    data: { read: false },
  });
  await page.goto('/items/demo-item-1');
  await expect(page.locator('.status-chip')).toHaveText('已读');
  await expect
    .poll(async () => {
      const response = await request.get('/api/bootstrap');
      return (await response.json()).items.find(
        (item: { id: string; read: boolean }) => item.id === 'demo-item-1',
      )?.read;
    })
    .toBe(true);
  await page.goto('/items/missing-item');
  await expect(page.getByRole('heading', { name: '404', exact: true })).toBeVisible();
});

test('read, inspect source, save and reload a demo update', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/feed');
  await expect(page.getByRole('heading', { name: '全部更新', exact: true })).toBeVisible();
  await page.getByLabel('搜索更新').fill('shadcn');
  await page.getByTestId('item-demo-item-0').click();
  await expect(page.getByRole('heading', { name: '这次更新了什么' })).toBeVisible();
  await page.getByRole('tab', { name: '原文', exact: true }).click();
  await expect(page.getByText('DEMO FIXTURE', { exact: false })).toBeVisible();
  await page.getByRole('tab', { name: '中文摘要' }).click();
  if (await page.getByRole('button', { name: '取消收藏', exact: true }).count())
    await page.getByRole('button', { name: '取消收藏', exact: true }).click();
  await page.getByRole('button', { name: '收藏更新', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消收藏', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '取消收藏', exact: true })).toBeVisible();
  await page.screenshot({ path: 'work/reader-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('filters and empty state work, and subscription dialog is accessible', async ({ page }) => {
  await page.goto('/feed');
  await page.getByLabel('搜索更新').fill('this-does-not-exist-0123');
  await expect(page.getByText('暂时没有匹配的更新')).toBeVisible();
  await page.getByRole('button', { name: '添加订阅', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('仓库地址或 owner/repo')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

for (const width of [390, 768])
  test(`reader fits ${width}px and returns from details`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/feed');
    await page.getByTestId('item-demo-item-0').click();
    await expect(page.getByRole('heading', { name: '这次更新了什么' })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: `work/reader-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: '返回列表', exact: true }).click();
    await expect(page.getByRole('heading', { name: '全部更新', exact: true })).toBeVisible();
  });
