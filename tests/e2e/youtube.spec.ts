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

const connected = {
  configured: true,
  state: 'connected' as const,
  name: 'My YouTube account',
  message: 'YouTube 已连接',
  expiresAt: null,
  retryAt: null,
};

test('temporary OAuth failure remains actionable after its toast expires', async ({ page }) => {
  await page.clock.install();
  await mockReaderBootstrap(page, (data) => ({
    ...data,
    jobs: [],
    services: { ...data.services, youtubeAuth: connected },
  }));
  await page.route('**/api/platforms/youtube/following/preview', (route) =>
    route.fulfill({
      json: { previewId: 'recovered-preview', channels: [], nextCursor: null, truncated: false },
    }),
  );
  await page.goto(
    '/subscriptions?youtube=failed&youtubeReason=temporary&youtubeDiagnostic=11111111-1111-4111-8111-111111111111',
  );
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toContainText('请稍后重试');
  await expect(dialog.getByRole('alert')).toContainText('诊断编号');
  await page.clock.fastForward(31000);
  await expect(page.locator('.toast')).toHaveCount(0);
  await expect(dialog.getByRole('alert')).toContainText('已有内容仍可阅读');
  await expect(page).toHaveURL(/\/subscriptions$/);
  await dialog.getByRole('button', { name: '读取我的关注', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByRole('tab', { name: '项目仓库', exact: true }).click();
  await dialog.getByRole('tab', { name: 'YouTube 关注' }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
});

async function openYouTube(page: import('@playwright/test').Page) {
  await page.goto('/subscriptions');
  await page.getByRole('button', { name: '刷新内容' }).click();
  await expect(page.locator('.toast')).toContainText('内容已刷新');
  await page.getByRole('button', { name: '添加订阅', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'YouTube 关注' }).click();
  return dialog;
}

test('a lost import response can be retried and reports existing sources without duplicate selection', async ({
  page,
}) => {
  await page.clock.install();
  const stored: Subscription[] = [];
  const existing = Array.from({ length: 49 }, (_, index) => ({
    ...channel,
    id: `existing-channel-${index}`,
    externalId: `existing-channel-${index}`,
  }));
  await mockReaderBootstrap(page, (data) => ({
    ...data,
    subscriptions: [...existing, ...stored, ...data.subscriptions],
    services: { ...data.services, youtubeAuth: connected },
  }));
  await page.route('**/api/platforms/youtube/following/preview', (route) =>
    route.fulfill({
      json: {
        previewId: 'lost-response-preview',
        channels: [
          { id: channel.externalId, name: channel.name, description: '', subscribed: false },
        ],
        nextCursor: null,
        truncated: false,
      },
    }),
  );
  let calls = 0;
  await page.route('**/api/platforms/youtube/following/import', async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      previewId: 'lost-response-preview',
      channelIds: [channel.externalId],
    });
    if (++calls === 1) {
      stored.push(channel);
      return route.abort('failed');
    }
    return route.fulfill({
      json: { added: [channel], failed: [], receipt: { created: 0, existing: 1, failed: 0 } },
    });
  });
  const dialog = await openYouTube(page);
  await dialog.getByRole('button', { name: '读取我的关注', exact: true }).click();
  await dialog.getByRole('button', { name: '导入 1 个频道', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('暂时无法连接服务');
  await expect(
    dialog.getByRole('checkbox', { name: `订阅 ${channel.name}`, exact: true }),
  ).toBeChecked();
  await page.clock.fastForward(31000);
  await expect(
    dialog.getByText('频道订阅上限：50 个，当前还可添加 0 个。', { exact: false }),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: '导入 1 个频道', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '导入 1 个频道', exact: true }).click();
  await expect(dialog.getByText('本次新增 0 个频道，已存在 1 个，失败 0 个。')).toBeVisible();
  await expect(
    dialog.getByRole('checkbox', { name: `订阅 ${channel.name}`, exact: true }),
  ).toBeDisabled();
  expect(calls).toBe(2);
  expect(stored).toHaveLength(1);
  await page.unrouteAll({ behavior: 'wait' });
});

for (const mode of ['expired-preview', 'account-changed-during-import'] as const) {
  test(`${mode} clears obsolete choices and requires a new preview`, async ({ page }) => {
    await mockReaderBootstrap(page, (data) => ({
      ...data,
      services: { ...data.services, youtubeAuth: connected },
    }));
    let reads = 0;
    await page.route('**/api/platforms/youtube/following/preview', (route) =>
      route.fulfill({
        json: {
          previewId: `current-preview-${++reads}`,
          channels: [
            { id: channel.externalId, name: channel.name, description: '', subscribed: false },
          ],
          nextCursor: null,
          truncated: false,
        },
      }),
    );
    await page.route('**/api/platforms/youtube/following/import', (route) =>
      route.fulfill(
        mode === 'expired-preview'
          ? { status: 409, json: { error: '关注预览已过期或账号已变化，请重新读取我的关注。' } }
          : {
              json: {
                added: [],
                failed: [
                  {
                    id: channel.externalId,
                    name: channel.name,
                    error: '平台账号已变化，请重新读取关注后导入。',
                  },
                ],
                receipt: { created: 0, existing: 0, failed: 1 },
                previewInvalidated: true,
              },
            },
      ),
    );
    const dialog = await openYouTube(page);
    await dialog.getByRole('button', { name: '读取我的关注', exact: true }).click();
    await dialog.getByRole('button', { name: '导入 1 个频道', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('请重新读取');
    await expect(dialog.getByRole('checkbox')).toHaveCount(0);
    await dialog.getByRole('button', { name: '读取我的关注', exact: true }).click();
    await expect(
      dialog.getByRole('checkbox', { name: `订阅 ${channel.name}`, exact: true }),
    ).toBeChecked();
    expect(reads).toBe(2);
    await page.unrouteAll({ behavior: 'wait' });
  });
}

test('unconfigured account explains OAuth setup and rejects unsafe or unsupported requests', async ({
  page,
  request,
  baseURL,
}) => {
  await page.goto('/subscriptions');
  await page.getByRole('button', { name: '添加订阅', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: '项目仓库', exact: true }).press('End');
  await expect(dialog.getByRole('tab', { name: 'YouTube 关注' })).toBeFocused();
  await expect(dialog.getByText(/请在服务端配置 YOUTUBE_CLIENT_ID/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: '连接 YouTube 账号' })).toBeDisabled();
  await expect(dialog.locator('input')).toHaveCount(0);
  const missing = await request.post('/api/platforms/youtube/connect', {
    headers: { Origin: baseURL! },
  });
  expect(missing.status()).toBe(503);
  expect((await missing.json()).error).toContain('OAuth');
  const foreign = await request.post('/api/platforms/youtube/connect', {
    headers: { Origin: 'https://foreign.test' },
  });
  expect(foreign.status()).toBe(403);
  const invalid = await request.post('/api/subscriptions', {
    headers: { Origin: baseURL! },
    data: { platform: 'youtube', kind: 'repo', input: 'owner/repo' },
  });
  expect(invalid.status()).toBe(400);
  const callback = await request.get(
    '/api/platforms/youtube/callback?state=invalid&code=private-code&returnTo=https://foreign.test',
    { maxRedirects: 0 },
  );
  expect(callback.status()).toBe(303);
  const callbackTarget = new URL(callback.headers().location);
  expect(callbackTarget.origin + callbackTarget.pathname).toBe(baseURL + '/subscriptions');
  expect(callbackTarget.searchParams.get('youtube')).toBe('failed');
  expect(callbackTarget.searchParams.get('youtubeReason')).toBe('state');
  expect(callbackTarget.href).not.toContain('private-code');
  expect(callback.headers()['set-cookie']).toContain('Max-Age=0');
});

test('own following supports cross-page selection, partial retry and responsive mobile import', async ({
  page,
}) => {
  const other = {
    ...channel,
    id: 'youtube-other',
    externalId: 'UC' + 'b'.repeat(22),
    name: 'Second channel',
  };
  const added: Subscription[] = [];
  let imports = 0;
  let reads = 0;
  await mockReaderBootstrap(page, (data) => ({
    ...data,
    subscriptions: [...added, ...data.subscriptions],
    services: { ...data.services, youtubeAuth: connected },
  }));
  await page.route('**/api/platforms/youtube/following/preview', async (route) => {
    reads++;
    const more = !!route.request().postDataJSON().cursor;
    expect(route.request().postDataJSON()).toEqual(
      more ? { previewId: 'preview-one', cursor: 'second-page' } : {},
    );
    await route.fulfill({
      json: {
        previewId: 'preview-one',
        channels: (more ? [channel, other] : [channel]).map((source) => ({
          id: source.externalId,
          name: source.name,
          description: source.description,
          subscribed: false,
        })),
        nextCursor: more ? null : 'second-page',
        truncated: false,
      },
    });
  });
  await page.route('**/api/platforms/youtube/following/import', async (route) => {
    imports++;
    expect(route.request().postDataJSON()).toEqual({
      previewId: 'preview-one',
      channelIds: imports === 1 ? [channel.externalId, other.externalId] : [other.externalId],
    });
    if (imports === 1) {
      added.push(channel);
      return route.fulfill({
        json: {
          added: [channel],
          failed: [{ id: other.externalId, name: other.name, error: '暂时无法读取频道' }],
        },
      });
    }
    added.push(other);
    return route.fulfill({ json: { added: [other], failed: [] } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = await openYouTube(page);
  await expect(dialog.getByText('My YouTube account', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/当前还可添加 50 个/)).toBeVisible();
  await dialog.getByRole('button', { name: '读取我的关注', exact: true }).click();
  await expect(dialog.getByRole('checkbox')).toHaveCount(1);
  await dialog.getByRole('button', { name: '加载更多关注' }).click();
  await expect(dialog.getByRole('checkbox')).toHaveCount(2);
  await dialog.getByRole('button', { name: '导入 2 个频道', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('部分频道未能导入');
  await expect(
    dialog.getByRole('checkbox', { name: '订阅 ' + channel.name, exact: true }),
  ).toBeDisabled();
  await expect(dialog.getByText(/当前还可添加 49 个/)).toBeVisible();
  await dialog.getByRole('button', { name: '导入 1 个频道', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByText('本次新增 1 个频道，已存在 0 个，失败 0 个。')).toBeVisible();
  await expect(dialog.getByText('本次新增 1 个频道，已存在 0 个，失败 0 个。')).toBeInViewport({
    ratio: 1,
  });
  await expect(dialog.getByRole('button', { name: '导入 0 个频道', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await expect(dialog.getByText(/当前还可添加 48 个/)).toBeVisible();
  const titleBox = await dialog.getByRole('heading').boundingBox();
  const closeBox = await dialog.getByRole('button', { name: '关闭添加订阅' }).boundingBox();
  expect(titleBox!.y).toBeGreaterThanOrEqual(0);
  expect(closeBox!.y).toBeGreaterThanOrEqual(0);
  expect(closeBox!.y + closeBox!.height).toBeLessThanOrEqual(844);
  expect(reads).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir('work', { recursive: true });
  await page.screenshot({ path: 'work/youtube-account-mobile.png', fullPage: true });
  await dialog.getByRole('button', { name: '关闭添加订阅' }).click();
  await page.getByRole('button', { name: '视频频道', exact: true }).click();
  await expect(page.getByRole('heading', { name: channel.name, exact: true })).toBeVisible();
});

test('empty follows, recoverable read errors and disconnect leave a clear account state', async ({
  page,
}) => {
  let disconnected = false;
  let attempts = 0;
  await mockReaderBootstrap(page, (data) => ({
    ...data,
    services: {
      ...data.services,
      youtubeAuth: disconnected
        ? { ...connected, state: 'disconnected', name: null, message: '尚未连接 YouTube' }
        : connected,
    },
  }));
  await page.route('**/api/platforms/youtube/following/preview', async (route) => {
    attempts++;
    if (attempts === 1)
      return route.fulfill({ status: 429, json: { error: 'YouTube 限流，请稍后重试。' } });
    return route.fulfill({
      json: { previewId: 'empty-preview', channels: [], nextCursor: null, truncated: false },
    });
  });
  await page.route('**/api/platforms/youtube/connection', async (route) => {
    expect(route.request().method()).toBe('DELETE');
    disconnected = true;
    return route.fulfill({
      json: {
        revoked: false,
        connection: {
          ...connected,
          state: 'disconnected',
          name: null,
          message: '尚未连接 YouTube',
        },
      },
    });
  });
  const dialog = await openYouTube(page);
  await dialog.getByRole('button', { name: '读取我的关注', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('限流');
  await dialog.getByRole('button', { name: '读取我的关注', exact: true }).click();
  await expect(dialog.getByText('这个账号还没有可读取的关注频道。')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '导入 0 个频道' })).toBeDisabled();
  page.on('dialog', (prompt) => prompt.accept());
  await dialog.getByRole('button', { name: '断开账号', exact: true }).click();
  await expect(dialog.getByText(/Google 授权撤销未确认/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: '连接 YouTube 账号' })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: /读取我的关注/ })).toHaveCount(0);
});

test('starts OAuth through the server and returns cancelled or failed authorization to its account panel', async ({
  page,
}) => {
  await mockReaderBootstrap(page, (data) => ({
    ...data,
    services: {
      ...data.services,
      youtubeAuth: { ...connected, state: 'disconnected', name: null, message: '尚未连接 YouTube' },
    },
  }));
  await page.route('**/api/platforms/youtube/connect', (route) =>
    route.fulfill({
      json: { url: 'https://accounts.google.com/o/oauth2/v2/auth?state=fixture-state' },
    }),
  );
  await page.route('https://accounts.google.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<p>Google authorization fixture</p>' }),
  );
  let dialog = await openYouTube(page);
  await dialog.getByRole('button', { name: '连接 YouTube 账号' }).click();
  await expect(page).toHaveURL(/accounts.google.com/);
  for (const outcome of ['cancelled', 'failed']) {
    await page.goto('/subscriptions?youtube=' + outcome);
    dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('tab', { name: 'YouTube 关注' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('.toast')).toContainText(
      outcome === 'cancelled' ? '已取消 YouTube 授权' : 'YouTube 授权未完成',
    );
    await expect(page).toHaveURL(/\/subscriptions$/);
  }
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
    await expect(detail.getByRole('tab')).toHaveCount(2);
    await expect(detail.getByRole('tab', { name: '简介对照翻译' })).toBeVisible();
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
