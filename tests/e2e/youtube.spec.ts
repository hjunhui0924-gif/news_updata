import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { mockReaderBootstrap } from './reader-fixtures';
import type { FeedItem, Subscription } from '../../src/shared/types';

const channel: Subscription = {
  id: 'youtube-source',
  externalId: `UC${'a'.repeat(22)}`,
  platform: 'youtube',
  kind: 'channel',
  name: 'Example YouTube Channel',
  description: 'Public video updates',
  url: `https://www.youtube.com/channel/UC${'a'.repeat(22)}`,
  enabled: true,
  priority: false,
  demo: false,
  createdAt: new Date().toISOString(),
  lastSyncAt: null,
  error: null,
  coverage: 'pending',
  syncWindowCapped: true,
};

test('unconfigured YouTube explains setup, keeps the input, and rejects unsupported platform/kind pairs', async ({
  page,
  request,
  baseURL,
}) => {
  await page.goto('/subscriptions');
  await page.getByRole('button', { name: '添加订阅', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: '项目仓库', exact: true }).press('End');
  await expect(dialog.getByRole('tab', { name: 'YouTube 频道' })).toBeFocused();
  await dialog.getByLabel('YouTube 频道 ID、@handle 或频道地址').fill('@my-channel');
  await expect(dialog.getByText(/尚未配置 YouTube API Key/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: '添加订阅', exact: true })).toBeDisabled();
  await expect(dialog.getByLabel('YouTube 频道 ID、@handle 或频道地址')).toHaveValue('@my-channel');
  const missing = await request.post('/api/subscriptions', {
    headers: { Origin: baseURL! },
    data: { platform: 'youtube', kind: 'channel', input: '@my-channel' },
  });
  expect(missing.status()).toBe(503);
  expect((await missing.json()).error).toContain('YouTube API Key');
  const invalid = await request.post('/api/subscriptions', {
    headers: { Origin: baseURL! },
    data: { platform: 'youtube', kind: 'repo', input: 'owner/repo' },
  });
  expect(invalid.status()).toBe(400);
});

test('adding a channel preserves recoverable input and shows the platform and coverage on mobile', async ({
  page,
}) => {
  let added = false;
  let attempt = 0;
  await mockReaderBootstrap(page, (data) => ({
    ...data,
    subscriptions: added ? [channel, ...data.subscriptions] : data.subscriptions,
    services: {
      ...data.services,
      platforms: { youtube: { configured: true, intervalMinutes: 180 } },
    },
  }));
  await page.route('**/api/subscriptions', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    expect(route.request().postDataJSON()).toEqual({
      platform: 'youtube',
      kind: 'channel',
      input: '@my-channel',
    });
    attempt++;
    if (attempt === 1)
      return route.fulfill({ status: 502, json: { error: '暂时无法读取 YouTube，请稍后重试。' } });
    added = true;
    return route.fulfill({ json: channel });
  });
  await page.goto('/subscriptions');
  await page.getByRole('button', { name: '刷新内容' }).click();
  await expect(page.locator('.toast')).toContainText('内容已刷新');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '添加订阅', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'YouTube 频道' }).click();
  await dialog.getByLabel('YouTube 频道 ID、@handle 或频道地址').fill('@my-channel');
  const submit = dialog.getByRole('button', { name: '添加订阅', exact: true });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(dialog.getByRole('alert')).toContainText('暂时无法读取 YouTube');
  await expect(dialog.getByLabel('YouTube 频道 ID、@handle 或频道地址')).toHaveValue('@my-channel');
  await submit.click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: '视频频道', exact: true }).click();
  await expect(page.getByRole('heading', { name: channel.name })).toBeVisible();
  await expect(page.getByText(/已达到最近 250 条窗口/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir('work', { recursive: true });
  await page.screenshot({ path: 'work/youtube-subscriptions-mobile.png', fullPage: true });
});

for (const width of [1440, 390]) {
  test(`mixed video feed reuses filters, read/save state and a safe description at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let video: FeedItem;
    await mockReaderBootstrap(page, (data) => {
      video = {
        ...data.items[0],
        id: 'youtube-fixture',
        externalId: 'abcdefghijk',
        platform: 'youtube',
        type: 'video',
        repo: channel.name,
        sourceName: channel.name,
        author: channel.name,
        title: 'A new YouTube video',
        description: 'A description, not a transcript.',
        body:
          'A description, not a transcript.\n<img src="https://evil.test/never-load">\n' +
          'Readable video description. '.repeat(160),
        sourceId: channel.id,
        sourceIds: [channel.id],
        matchedSources: [{ id: channel.id, kind: 'channel', name: channel.name }],
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
        media: {
          kind: 'video',
          content: 'description',
          thumbnailUrl: 'https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg',
        },
        summary: null,
        translation: null,
        translationBlocks: null,
        aiStatus: 'insufficient',
        read: false,
        saved: false,
        demo: false,
        tags: ['YouTube'],
      };
      return {
        ...data,
        items: [video, ...data.items],
        subscriptions: [channel, ...data.subscriptions],
      };
    });
    await page.route('https://i.ytimg.com/**', (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="#e8edf9"/><rect x="126" y="65" width="68" height="50" rx="12" fill="#365ace"/><path d="M153 78L174 90L153 102Z" fill="white"/></svg>',
      }),
    );
    await page.goto('/feed');
    await page.getByRole('button', { name: '刷新内容' }).click();
    await expect(page.locator('.toast')).toContainText('内容已刷新');
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await expect(page.getByTestId('item-youtube-fixture')).toBeVisible();
    await page.getByRole('button', { name: '新视频', exact: true }).click();
    await expect(page.locator('.update-card')).toHaveCount(1);
    await expect(page.locator('.video-thumbnail')).toHaveAttribute('loading', 'lazy');
    await page.getByTestId('item-youtube-fixture').click();
    const detail = page.getByRole('region', { name: '更新详情' });
    await expect(detail.getByRole('tab', { name: '视频简介' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(detail.getByRole('tab')).toHaveCount(1);
    await expect(detail.getByText('简介较长', { exact: true })).toHaveCount(1);
    await expect(detail.getByText(/按 Markdown 结构阅读/)).toHaveCount(0);
    await expect(detail.getByText('作者提供的视频简介，请以原视频为准')).toHaveCount(1);
    await expect(detail.getByText(/不是字幕、转写或视频全文/)).toBeVisible();
    await expect(detail.locator('.video-description')).toContainText(
      '<img src="https://evil.test/never-load">',
    );
    await expect(detail.locator('.video-description img')).toHaveCount(0);
    await expect(detail.getByRole('link', { name: /在 YouTube 观看/ })).toHaveAttribute(
      'href',
      'https://www.youtube.com/watch?v=abcdefghijk',
    );
    await expect(page.locator('iframe,video,audio')).toHaveCount(0);
    await detail.getByRole('button', { name: '收藏更新', exact: true }).click();
    await expect(detail.getByRole('button', { name: '取消收藏', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await mkdir('work', { recursive: true });
    await page.screenshot({
      path: `work/youtube-${width === 390 ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    });
    if (width === 390) await detail.getByRole('button', { name: '返回列表', exact: true }).click();
    else await page.goBack();
    await expect(page.getByTestId('item-youtube-fixture')).toHaveClass(/read/);
    await expect(page.getByTestId('item-youtube-fixture')).toBeFocused();
    expect(errors).toEqual([]);
  });
}
