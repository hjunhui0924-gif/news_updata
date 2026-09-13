import { expect, test } from '@playwright/test';
import type { TrendingSnapshot } from '../../src/shared/trending';

const snapshot: TrendingSnapshot = {
  repositories: [
    {
      name: 'example/fast-tools',
      url: 'https://github.com/example/fast-tools',
      rank: 1,
      description: 'Build useful developer tools.',
      language: 'Python',
      stars: 12300,
      starsToday: 1045,
    },
    {
      name: 'example/reader',
      url: 'https://github.com/example/reader',
      rank: 2,
      description: 'A quiet reading application.',
      language: 'TypeScript',
      stars: 1500,
      starsToday: 85,
      chineseDescription: '一个安静的阅读应用。',
    },
  ],
  fetchedAt: '2026-09-13T10:00:00Z',
  sourceUrl: 'https://github.com/trending?since=daily',
  language: '',
  stale: false,
  error: null,
  retryAt: null,
};
test('discovery reads Trending independently of Stars, translates and subscribes with mobile support', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let subscribed = 0;
  let translated = 0;
  await page.route('**/api/trending?*', (route) => {
    const language = new URL(route.request().url()).searchParams.get('language') ?? '';
    return route.fulfill({
      json: {
        ...snapshot,
        language,
        repositories:
          language === 'typescript' ? [snapshot.repositories[1]] : snapshot.repositories,
      },
    });
  });
  await page.route('**/api/bootstrap', async (route) => {
    const data = await (await route.fetch()).json();
    return route.fulfill({
      json: {
        ...data,
        services: { ...data.services, ai: true },
        subscriptions: subscribed
          ? [
              ...data.subscriptions,
              { id: 'new-subscription', kind: 'repo', name: 'example/fast-tools', enabled: true },
            ]
          : data.subscriptions,
      },
    });
  });
  await page.route('**/api/subscriptions', (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    expect(route.request().postDataJSON()).toEqual({ kind: 'repo', input: 'example/fast-tools' });
    subscribed++;
    return route.fulfill({ json: { id: 'new-subscription' } });
  });
  await page.route('**/api/trending/translation', (route) => {
    translated++;
    return route.fulfill({
      json: {
        description: snapshot.repositories[0].description,
        translation: '构建实用的开发工具。',
      },
    });
  });
  await page.goto('/today');
  await page.getByRole('button', { name: '刷新内容' }).click();
  const card = page.getByRole('article', { name: 'example/fast-tools', exact: true });
  await expect(card.getByText('今日 +1,045')).toBeVisible();
  await card.getByRole('button', { name: '翻译简介' }).click();
  await expect(card.getByText('构建实用的开发工具。')).toBeVisible();
  await card.getByRole('button', { name: '订阅更新' }).click();
  await expect(card.getByRole('button', { name: '已订阅', exact: true })).toBeDisabled();
  expect(subscribed).toBe(1);
  expect(translated).toBe(1);
  // A removal in another tab is reflected by the next authoritative bootstrap refresh.
  subscribed = 0;
  await page.getByRole('button', { name: '刷新内容' }).click();
  await expect(card.getByRole('button', { name: '订阅更新' })).toBeEnabled();
  await page.screenshot({ path: 'work/discovery-desktop.png', fullPage: true });
  await page.getByRole('combobox', { name: '编程语言' }).selectOption('typescript');
  await expect(card).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'example/reader' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(page.getByText('一个安静的阅读应用。')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'work/discovery-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('stale snapshots, loading, first-load failure and retries remain explicit', async ({
  page,
}) => {
  let failed = true;
  await page.route('**/api/trending?*', async (route) => {
    const language = new URL(route.request().url()).searchParams.get('language') ?? '';
    return route.fulfill({
      json: {
        ...snapshot,
        language,
        repositories: language === 'rust' && failed ? [] : snapshot.repositories,
        fetchedAt: language === 'rust' && failed ? null : snapshot.fetchedAt,
        stale: failed,
        error: failed ? 'Trending 获取失败。已有榜单保留供阅读，15 分钟后可重试。' : null,
      },
    });
  });
  await page.goto('/today');
  await expect(page.getByRole('alert').filter({ hasText: 'Trending 获取失败' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'example/fast-tools' })).toBeVisible();
  await expect(page.getByText('旧快照：', { exact: false })).toBeVisible();
  await page.getByRole('combobox', { name: '编程语言' }).selectOption('rust');
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: 'Trending 获取失败' })).toBeVisible();
  failed = false;
  await page.getByRole('button', { name: '刷新榜单' }).click();
  await expect(page.getByRole('article', { name: 'example/fast-tools' })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Trending 项目发现' }).getByRole('alert'),
  ).toHaveCount(0);
});
