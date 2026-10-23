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
  const originalTab = page.getByRole('tab', { name: '原文', exact: true });
  await expect(originalTab).toHaveAttribute('aria-controls', 'reader-detail-panel');
  await expect(page.getByRole('tabpanel')).toHaveAttribute(
    'aria-labelledby',
    'reader-detail-tab-original',
  );
  await originalTab.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: '对照翻译' })).toBeFocused();
  await expect(page.getByRole('tab', { name: '对照翻译' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: '对照翻译' }).press('Home');
  await expect(page.getByRole('tab', { name: '中文摘要' })).toBeFocused();
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
  await page.getByRole('button', { name: '清除筛选' }).click();
  await expect(page.getByTestId('item-demo-item-0')).toBeVisible();
  await page.getByRole('button', { name: '添加订阅', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('仓库地址或 owner/repo')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('feed and saved views distinguish a true empty state from filtered results', async ({ page }) => {
  await page.route('**/api/bootstrap', async (route) => {
    const data = await (await route.fetch()).json();
    await route.fulfill({ json: { ...data, items: [] } });
  });
  await page.goto('/feed');
  await page.getByRole('button', { name: '刷新内容' }).click();
  await expect(page.getByRole('heading', { name: '还没有更新' })).toBeVisible();
  await expect(page.getByRole('button', { name: '清除筛选' })).toHaveCount(0);
  await page.locator('.main-nav button').filter({ hasText: '已收藏' }).click();
  await expect(page.getByRole('heading', { name: '还没有收藏的更新' })).toBeVisible();
});

test('subscription category filters expose their selected state and empty categories can add a source', async ({
  page,
}) => {
  await page.goto('/subscriptions');
  await page.getByRole('button', { name: '刷新内容' }).click();
  const categories = page.locator('.management-tabs');
  await expect(categories.getByRole('button', { name: '全部来源' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await categories.getByRole('button', { name: '开发者' }).click();
  await expect(categories.getByRole('button', { name: '开发者' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  if (await page.getByRole('heading', { name: '这个分类还没有订阅' }).count()) {
    await page.getByRole('button', { name: '添加订阅', exact: true }).last().click();
    await expect(page.getByRole('dialog')).toBeVisible();
  }
});

test('failed subscription submission retains the input and keeps the dialog recoverable', async ({
  page,
}) => {
  let fail = true;
  await page.route('**/api/subscriptions', async (route) => {
    if (fail) {
      await route.fulfill({ status: 503, json: { error: 'GitHub 暂时无法访问，请重试。' } });
      return;
    }
    await route.fulfill({ json: { id: 'new-subscription' } });
  });
  await page.goto('/subscriptions');
  await page.getByRole('button', { name: '刷新内容' }).click();
  await page.getByRole('button', { name: '添加订阅', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  const input = dialog.getByLabel('仓库地址或 owner/repo');
  await input.fill('octocat/hello-world');
  await dialog.getByRole('button', { name: '添加订阅', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('GitHub 暂时无法访问，请重试。');
  await expect(input).toHaveValue('octocat/hello-world');
  fail = false;
  await dialog.getByRole('button', { name: '添加订阅', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test('detail return preserves feed context and onboarding stays on subscriptions', async ({ page }) => {
  await page.goto('/feed');
  const search = page.getByLabel('搜索更新');
  await search.fill('shadcn');
  await page.getByTestId('item-demo-item-0').click();
  await page.goBack();
  await expect(search).toHaveValue('shadcn');
  await expect(page.getByTestId('item-demo-item-0')).toBeVisible();

  await page.evaluate(() => {
    history.pushState({}, '', '/onboarding');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.locator('.management-page h1')).toHaveText('关注你真正关心的');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('navigation exposes the active route and moves focus to its title', async ({ page }) => {
  await page.goto('/feed');
  await expect(page.locator('.main-nav [aria-current="page"]')).toHaveText(/全部更新/);
  await page.locator('.main-nav button').filter({ hasText: '已收藏' }).click();
  await expect(page.locator('.main-nav [aria-current="page"]')).toHaveText(/已收藏/);
  await expect(page.locator('.top-breadcrumb strong')).toHaveText('已收藏');
  await expect(page.locator('.top-breadcrumb strong')).toBeFocused();
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
