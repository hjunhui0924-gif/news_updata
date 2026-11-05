import { chromium, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDemoData } from '../src/server/demo/fixtures';
import { mockReaderBootstrap } from '../tests/e2e/reader-fixtures';
import type { FeedItem, Subscription } from '../src/shared/types';

// Refuse real accounts. All captured data and search responses below are synthetic.
const target = new URL(
  process.argv.slice(2).find((arg) => arg !== '--') || 'http://127.0.0.1:3000',
);
if (
  target.protocol !== 'http:' ||
  !['127.0.0.1', 'localhost'].includes(target.hostname) ||
  target.username ||
  target.password ||
  target.pathname !== '/' ||
  target.search ||
  target.hash
)
  throw new Error('Screenshots require a loopback Demo origin.');
const response = await fetch(new URL('/api/bootstrap', target), {
  signal: AbortSignal.timeout(10000),
});
if (!response.ok || (await response.json()).mode !== 'demo')
  throw new Error('Refusing to capture a live or unavailable account. Start a local Demo first.');

const now = new Date();
const fixture = createDemoData(now);
const videoSource: Subscription = {
  ...fixture.subscriptions[0],
  id: 'docs-video-source',
  externalId: 'docs-video-channel',
  kind: 'channel',
  platform: 'youtube',
  name: '知更演示频道',
  description: '演示数据：聚合阅读与开发实践。',
  url: 'https://www.youtube.com/',
  priority: false,
};
const items: FeedItem[] = fixture.items.map((item, index) =>
  index === 1
    ? {
        ...item,
        id: 'docs-video-item',
        sourceId: videoSource.id,
        sourceIds: [videoSource.id],
        platform: 'youtube',
        type: 'video',
        repo: videoSource.name,
        sourceName: videoSource.name,
        author: videoSource.name,
        title: '用一个阅读器整理不同平台的更新',
        description: '演示视频简介：在统一时间线中筛选平台、整理关注，给阅读留出更清楚的空间。',
        body: 'DEMO FIXTURE — This is an illustrative video description, not a real video announcement.',
        url: videoSource.url,
        contentUrl: videoSource.url,
        media: { kind: 'video', content: 'description' },
        summary: null,
        translation: null,
        aiStatus: 'disabled',
        tags: ['阅读体验'],
        priority: false,
      }
    : item,
);

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    (process.platform === 'win32' &&
    existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')
      ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
      : undefined),
});
const context = await browser.newContext({
  baseURL: target.origin,
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
});
const page = await context.newPage();
const errors: string[] = [];
const unexpected: string[] = [];
let metadataReads = 0;
page.on('pageerror', (error) => errors.push(error.message));
page.on('response', (result) => {
  if (new URL(result.url()).pathname === '/api/bootstrap' && result.ok()) metadataReads++;
});
try {
  // Other than the shell and read-only Demo metadata, never send requests to providers.
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin !== target.origin) return route.abort();
    return route.continue();
  });
  await page.route('**/api/**', async (route) => {
    unexpected.push(new URL(route.request().url()).pathname);
    await route.fulfill({
      status: 503,
      json: { error: 'Documentation fixture does not implement this action.' },
    });
  });
  await mockReaderBootstrap(page, (data) => ({
    ...data,
    user: { name: '演示用户' },
    items,
    subscriptions: [...fixture.subscriptions, videoSource],
    preferences: { compact: false, timezone: 'Asia/Shanghai' },
    jobs: [],
    notifications: [],
    starSync: null,
    services: {
      ...data.services,
      github: true,
      ai: false,
      localSkills: false,
      workerOnline: true,
      workerLastSeen: now.toISOString(),
      costToday: 0,
      githubAuth: { state: 'connected', message: '演示连接状态', expiresAt: null, retryAt: null },
    },
  }));
  await page.route('**/api/github/repositories/search', async (route) => {
    const query = route.request().postDataJSON().query;
    await route.fulfill({
      json: {
        query,
        page: 1,
        totalCount: 2,
        incomplete: false,
        nextPage: null,
        repositories: [
          {
            id: 'docs-project-1',
            name: 'demo/reading-notes',
            description: '演示项目：把关注的更新整理成便于阅读的笔记。',
            language: 'TypeScript',
            stars: 1280,
          },
          {
            id: 'docs-project-2',
            name: 'demo/quiet-feed',
            description: '演示项目：用简单清晰的时间线阅读不同来源的内容。',
            language: 'React',
            stars: 860,
          },
        ].map((repo) => ({
          ...repo,
          url: `https://github.com/${repo.name}`,
          updatedAt: now.toISOString(),
          archived: false,
          subscribed: false,
        })),
      },
    });
  });
  const output = resolve('docs/assets');
  await mkdir(output, { recursive: true });
  async function navigate(path: string) {
    await page.goto(path);
    const previous = metadataReads;
    await expect
      .poll(
        async () => {
          await page.getByRole('button', { name: '刷新内容', exact: true }).click();
          return metadataReads;
        },
        { timeout: 15000 },
      )
      .toBeGreaterThan(previous);
    await expect(page.getByRole('status').filter({ hasText: '内容已刷新' })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText('体验工作空间', { exact: true }).first()).toBeVisible();
  }
  async function capture(name: string) {
    await expect(page.locator('.toast').filter({ hasText: '内容已刷新' })).toBeHidden({
      timeout: 10000,
    });
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => page.evaluate(() => document.styleSheets.length)).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: resolve(output, name), animations: 'disabled' });
  }

  await navigate('/feed');
  await page.getByRole('button', { name: '列表布局', exact: true }).click();
  await expect(page.getByTestId('item-docs-video-item')).toBeVisible();
  await capture('reader-feed-demo.png');
  await page.getByRole('button', { name: '分栏阅读', exact: true }).click();
  await page.getByTestId('item-demo-item-0').click();
  await expect(page.getByRole('heading', { name: '这次更新了什么' })).toBeVisible();
  await capture('reader-demo.png');

  await navigate('/subscriptions');
  await page.locator('.management-heading').getByRole('button', { name: '添加订阅' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: '搜索项目', exact: true }).click();
  await dialog.getByLabel('搜索 GitHub 公开项目').fill('reading');
  await dialog.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(dialog.getByText('demo/reading-notes', { exact: true })).toBeVisible();
  await capture('project-search-demo.png');
  await page.keyboard.press('Escape');

  await navigate('/settings');
  const compact = page.getByRole('switch', { name: '紧凑列表', exact: true });
  if ((await compact.getAttribute('aria-checked')) === 'true') await compact.click();
  await expect(page.getByRole('status').filter({ hasText: '偏好已同步' })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存偏好', exact: true })).toBeVisible();
  await capture('settings-demo.png');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/feed');
  await expect(page.getByTestId('item-docs-video-item')).toBeVisible();
  await page.getByRole('heading', { name: '全部更新', exact: true }).click();
  await capture('reader-mobile-demo.png');
  expect(errors).toEqual([]);
  expect(unexpected).toEqual([]);
  console.log(
    'Captured 5 Demo-only README screenshots; no page errors, unexpected APIs or horizontal overflow.',
  );
} finally {
  await browser.close();
}
