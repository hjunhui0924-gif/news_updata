import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import type { FeedItem } from '../../src/shared/types';
import { mockReaderBootstrap } from './reader-fixtures';

test('direct detail links persist read state and missing items show 404', async ({
  page,
  request,
  baseURL,
}) => {
  await request.patch('/api/items/demo-item-1/state', {
    headers: { Origin: new URL(baseURL!).origin },
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
  await expect(page.getByRole('tab', { name: '对照翻译' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('tab', { name: '对照翻译' }).press('Home');
  await expect(page.getByRole('tab', { name: '中文摘要' })).toBeFocused();
  await page.getByRole('tab', { name: '中文摘要' }).click();
  if (await page.getByRole('button', { name: '取消收藏', exact: true }).count())
    await page.getByRole('button', { name: '取消收藏', exact: true }).click();
  await page.getByRole('button', { name: '收藏更新', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消收藏', exact: true })).toBeVisible();
  const hydratedDetail = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' && response.url().endsWith('/api/items/demo-item-0'),
  );
  await page.reload();
  await hydratedDetail;
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

test('feed and saved views distinguish a true empty state from filtered results', async ({
  page,
}) => {
  await page.route('**/api/feed?**', async (route) => {
    await route.fulfill({
      json: { items: [], total: 0, unread: 0, saved: 0, all: 0, nextCursor: null },
    });
  });
  await page.goto('/feed');
  await page.getByRole('button', { name: '刷新内容' }).click();
  await expect(page.getByRole('heading', { name: '还没有更新' })).toBeVisible();
  await expect(page.getByRole('button', { name: '清除筛选' })).toHaveCount(0);
  await page.locator('.main-nav button').filter({ hasText: '已收藏' }).click();
  await expect(page.getByRole('heading', { name: '还没有收藏的更新' })).toBeVisible();
});

test('feed loads the next server page without replacing the first page', async ({ page }) => {
  await page.route('**/api/feed?**', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.has('cursor')) {
      const actual = await (
        await route.fetch({ url: new URL('/api/feed', route.request().url()).toString() })
      ).json();
      await route.fulfill({
        json: {
          ...actual,
          items: [{ ...actual.items[0], id: 'next-page-item', title: 'Unique next page item' }],
          total: 2,
          nextCursor: null,
        },
      });
      return;
    }
    const response = await route.fetch();
    const pageData = await response.json();
    await route.fulfill({
      json: {
        ...pageData,
        items: [pageData.items[0]],
        total: 2,
        nextCursor: 'next-page',
      },
    });
  });
  await page.goto('/feed');
  const firstItem = page.locator('[data-testid^="item-"]').first();
  await expect(firstItem).toBeVisible();
  const firstItemId = await firstItem.getAttribute('data-testid');
  const nextPageRequest = page.waitForRequest(
    (request) =>
      request.url().includes('/api/feed?') && new URL(request.url()).searchParams.has('cursor'),
  );
  await page.getByRole('button', { name: '加载更多更新' }).click();
  await nextPageRequest;
  await expect(page.getByTestId(firstItemId!)).toBeVisible();
  await expect(page.locator('.update-card')).toHaveCount(2);
  await expect(page.getByTestId('item-next-page-item')).toBeVisible();
  await expect(page.getByRole('button', { name: '加载更多更新' })).toHaveCount(0);
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

test('detail return preserves feed context and onboarding stays on subscriptions', async ({
  page,
}) => {
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

test('platform filters keep mixed source rows explicit and composable', async ({ page }) => {
  await mockReaderBootstrap(page, (data) => data, (items) =>
    items.map((item, index) => ({
      ...item,
      publishedAt: index < 4 ? '2026-11-04T12:00:00.000Z' : '2026-11-03T12:00:00.000Z',
      ...(index % 3 === 0
        ? { platform: 'youtube', type: 'video' as const, media: { kind: 'video' as const, content: 'description' as const } }
        : { platform: 'github' }),
    })),
  );
  await page.goto('/feed');
  const platformFilters = page.getByRole('group', { name: '平台筛选' });
  await platformFilters.getByRole('button', { name: 'YouTube' }).click();
  await expect(platformFilters.getByRole('button', { name: 'YouTube' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.update-card').first()).toBeVisible();
  await expect(page.locator('.update-card .platform-label.youtube')).not.toHaveCount(0);
  await expect(page.locator('.update-card .platform-label.github')).toHaveCount(0);
  const dayHeadings = page.locator('.feed-day-heading');
  await expect(dayHeadings).toHaveCount(2);
  await expect(dayHeadings.nth(0)).toContainText('昨天');
  await expect(dayHeadings.nth(1)).toContainText('11月3日');
  await page.getByRole('button', { name: '未读更新' }).click();
  await expect(page.getByRole('heading', { name: '未读更新', exact: true })).toBeVisible();
  await expect(page.locator('.update-card .platform-label.youtube')).not.toHaveCount(0);
  await expect(page.locator('.update-card .platform-label.github')).toHaveCount(0);
});

test('video detail keeps the description boundary and opens the original platform', async ({
  page,
}) => {
  const makeVideo = (item: FeedItem) => ({
    ...item,
    platform: 'youtube' as const,
    type: 'video' as const,
    url: 'https://www.youtube.com/watch?v=demo-video',
    body: '作者提供的视频简介正文。',
    description: '作者提供的视频简介正文。',
    media: { kind: 'video' as const, content: 'description' as const },
  });
  await mockReaderBootstrap(
    page,
    (data) => ({ ...data, items: data.items.map((item, index) => (index === 0 ? makeVideo(item) : item)) }),
    (items) => items.map((item, index) => (index === 0 ? makeVideo(item) : item)),
  );
  await page.goto('/feed');
  await page.getByTestId('item-demo-item-0').click();
  await expect(page.getByRole('tab', { name: '视频简介' })).toBeVisible();
  await expect(page.locator('.video-source-card')).toContainText('不是字幕、转写或视频全文');
  await expect(page.getByText('作者提供的视频简介正文。')).toBeVisible();
  await expect(page.getByRole('link', { name: '在 YouTube 观看' })).toHaveAttribute(
    'href',
    'https://www.youtube.com/watch?v=demo-video',
  );
});

test('desktop reader switches between list and split layouts', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/feed');
  const reader = page.locator('.reader-grid');
  await expect(reader).toHaveClass(/list-layout/);
  await page.getByRole('button', { name: '分栏阅读' }).click();
  await expect(reader).toHaveClass(/split-layout/);
  await page.getByRole('button', { name: '列表布局' }).click();
  await expect(reader).toHaveClass(/list-layout/);
});

test('mobile navigation drawer exposes tools and restores focus when dismissed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/feed');
  const trigger = page.getByRole('button', { name: '打开导航' });
  await trigger.click();
  const drawer = page.getByRole('dialog', { name: '聚合阅读导航' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: '更多工具' }).click();
  await drawer.getByRole('button', { name: 'Skill 目录' }).click();
  await expect(drawer).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Skill 目录', exact: true })).toBeVisible();
  await trigger.click();
  await page.getByRole('button', { name: '关闭导航' }).click();
  await expect(trigger).toBeFocused();
});

for (const width of [320, 390, 768, 1280, 1440])
  test(`reader fits ${width}px and returns from details`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await page.goto('/feed');
    await expect(page.getByTestId('item-demo-item-0')).toBeVisible();
    await page.screenshot({
      path: `output/playwright/redesign-current/feed-${width}.png`,
      fullPage: true,
    });
    await page.getByTestId('item-demo-item-0').click();
    await expect(page.getByRole('heading', { name: '这次更新了什么' })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await mkdir('output/playwright/redesign-current', { recursive: true });
    await page.screenshot({
      path: `output/playwright/redesign-current/reader-${width}.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: '返回列表', exact: true }).click();
    await expect(page.getByRole('heading', { name: '全部更新', exact: true })).toBeVisible();
  });
