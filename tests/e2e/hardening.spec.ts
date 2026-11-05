import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import type { FeedItem } from '../../src/shared/types';
import { toFeedPreview } from '../../src/shared/feed';
import { writeFile, mkdir } from 'node:fs/promises';

test('loaded pages, filters, read/save counters and return context stay consistent', async ({
  page,
  request,
}) => {
  const initial = await (await request.get('/api/bootstrap')).json();
  const fullItem = await (await request.get(`/api/items/${initial.items[0].id}`)).json();
  const rows: FeedItem[] = Array.from({ length: 65 }, (_, index) => ({
    ...fullItem,
    id: `fixture-${index}`,
    title: `Fixture release ${index}`,
    read: false,
    saved: index % 2 === 0,
  }));
  await page.route(/\/api\/items\/fixture-\d+$/, async (route) => {
    await route.fulfill({ json: rows.find((item) => route.request().url().endsWith(item.id)) });
  });
  await page.route('**/api/feed?**', async (route) => {
    const query = new URL(route.request().url()).searchParams;
    const filtered = rows.filter(
      (item) =>
        (query.get('view') !== 'saved' || item.saved) &&
        (query.get('unread') !== 'true' || !item.read) &&
        item.title.includes(query.get('search') || ''),
    );
    const offset = Number(query.get('cursor') || 0);
    await route.fulfill({
      json: {
        items: filtered.slice(offset, offset + 30),
        total: filtered.length,
        all: rows.length,
        saved: rows.filter((item) => item.saved).length,
        unread: rows.filter((item) => !item.read).length,
        nextCursor: offset + 30 < filtered.length ? String(offset + 30) : null,
      },
    });
  });
  await page.route('**/api/items/*/state', async (route) => {
    const id = route.request().url().split('/').at(-2);
    Object.assign(
      rows.find((item) => item.id === id)!,
      route.request().postDataJSON(),
    );
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto('/feed');
  await page.getByRole('button', { name: '分栏阅读', exact: true }).click();
  await expect(page.locator('.update-card')).toHaveCount(30);
  await page.getByRole('button', { name: '加载更多更新' }).click();
  await expect(page.locator('.update-card')).toHaveCount(60);
  await page.getByTestId('item-fixture-40').click();
  const scrollTop = await page
    .getByRole('region', { name: '更新列表' })
    .evaluate((element) => element.scrollTop);
  expect(scrollTop).toBeGreaterThan(0);
  await expect(page.getByTestId('item-fixture-40')).toHaveClass(/read/);
  await expect(page.locator('.main-nav button').filter({ hasText: '全部更新' })).toContainText(
    '64',
  );
  await page.goBack();
  await expect(page.locator('.update-card')).toHaveCount(60);
  await expect
    .poll(() =>
      page.getByRole('region', { name: '更新列表' }).evaluate((element) => element.scrollTop),
    )
    .toBe(scrollTop);
  await page.locator('.main-nav button').filter({ hasText: '已收藏' }).click();
  await expect(page.locator('.update-card')).toHaveCount(30);
  await page.getByRole('button', { name: '刷新内容' }).click();
  await expect(page.locator('.update-card')).toHaveCount(30);
  expect(
    await page
      .locator('.update-card')
      .evaluateAll((cards) =>
        cards.every(
          (card) => Number(card.getAttribute('data-testid')!.split('-').at(-1)) % 2 === 0,
        ),
      ),
  ).toBe(true);
  await page.getByLabel('搜索更新').fill('Fixture release 64');
  await expect(page.locator('.update-card')).toHaveCount(1);
  await page.getByRole('button', { name: '刷新内容' }).click();
  await expect(page.getByTestId('item-fixture-64')).toBeVisible();
  await expect(page.locator('.update-card')).toHaveCount(1);
  await page.getByTestId('item-fixture-64').click();
  await page.getByRole('button', { name: '取消收藏', exact: true }).click();
  await expect(page.locator('.update-card')).toHaveCount(0);
  await expect(page.locator('.main-nav button').filter({ hasText: '已收藏' })).toContainText('32');
  await expect(page.getByRole('region', { name: '更新详情' })).toBeVisible();
  await page.getByRole('button', { name: '收藏更新', exact: true }).click();
  await expect(page.getByTestId('item-fixture-64')).toBeVisible();
  await page.locator('.main-nav button').filter({ hasText: '全部更新' }).click();
  await expect(page.locator('.update-card')).toHaveCount(60);
  await page.getByRole('button', { name: '加载更多更新' }).click();
  await expect(page.locator('.update-card')).toHaveCount(65);
  expect(
    new Set(
      await page
        .locator('.update-card')
        .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-testid'))),
    ).size,
  ).toBe(65);
});

async function fixture(page: Page, request: APIRequestContext, count = 3) {
  const initial = await (await request.get('/api/bootstrap')).json();
  const fullItem = await (await request.get(`/api/items/${initial.items[0].id}`)).json();
  const rows: FeedItem[] = Array.from({ length: count }, (_, index) => ({
    ...fullItem,
    id: `state-${index}`,
    title: `State ${index}`,
    read: false,
    saved: true,
  }));
  await page.route('**/api/feed?**', async (route) => {
    const query = new URL(route.request().url()).searchParams;
    const filtered = rows.filter(
      (item) =>
        (query.get('view') !== 'saved' || item.saved) &&
        (query.get('unread') !== 'true' || !item.read) &&
        item.title.toLowerCase().includes((query.get('search') || '').toLowerCase()),
    );
    if (query.get('status') === 'true') {
      await route.fulfill({
        json: {
          headId: filtered[0]?.id ?? null,
          total: filtered.length,
          all: rows.length,
          unread: rows.filter((item) => !item.read).length,
          saved: rows.filter((item) => item.saved).length,
          matchingUnread: filtered.filter((item) => !item.read).length,
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        items: filtered
          .slice(Number(query.get('cursor') || 0), Number(query.get('cursor') || 0) + 30)
          .map(toFeedPreview),
        total: filtered.length,
        all: rows.length,
        unread: rows.filter((item) => !item.read).length,
        saved: rows.filter((item) => item.saved).length,
        matchingUnread: filtered.filter((item) => !item.read).length,
        nextCursor:
          Number(query.get('cursor') || 0) + 30 < filtered.length
            ? String(Number(query.get('cursor') || 0) + 30)
            : null,
      },
    });
  });
  await page.route(/\/api\/items\/state-\d+$/, async (route) => {
    await route.fulfill({ json: rows.find((item) => route.request().url().endsWith(item.id)) });
  });
  await page.route('**/api/items/*/state', async (route) => {
    Object.assign(
      rows.find((item) => route.request().url().includes(item.id))!,
      route.request().postDataJSON(),
    );
    await route.fulfill({ json: { ok: true } });
  });
  return rows;
}

test('empty feed and saved views offer an actionable next step', async ({ page, request }) => {
  await fixture(page, request, 0);
  await page.goto('/feed');
  await page.getByRole('button', { name: '添加第一份订阅' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('.main-nav button').filter({ hasText: '已收藏' }).click();
  await page.getByRole('button', { name: '浏览全部更新' }).click();
  await expect(page.getByRole('heading', { name: '还没有更新', exact: true })).toBeVisible();
});

test('failed refresh retains rows and search failures can be retried without losing input', async ({
  page,
  request,
}) => {
  await fixture(page, request);
  await page.goto('/feed');
  await expect(page.locator('.update-card')).toHaveCount(3);
  let fail = true;
  await page.route('**/api/feed?**', async (route) => {
    if (fail) await route.fulfill({ status: 503, json: { error: '暂时不可用，请重试。' } });
    else await route.fallback();
  });
  await page.getByRole('button', { name: '刷新内容' }).click();
  await expect(page.locator('.feed-panel [role="alert"]')).toContainText('暂时不可用');
  await expect(page.locator('.update-card')).toHaveCount(3);
  await page.getByLabel('搜索更新').fill('State 1');
  await expect(page.getByLabel('搜索更新')).toHaveValue('State 1');
  await expect(page.getByRole('button', { name: '重试加载', exact: true })).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: '重试加载', exact: true }).click();
  await expect(page.getByTestId('item-state-1')).toBeVisible();
  await expect(page.locator('.update-card')).toHaveCount(1);
  await page.getByLabel('搜索更新').fill('no matching update');
  await expect(page.getByRole('button', { name: '清除筛选' })).toBeVisible();
  await page.getByRole('button', { name: '清除筛选' }).click();
  await expect(page.locator('.update-card')).toHaveCount(3);
});

test('mobile detail errors allow return and retry while refreshed content preserves its tab', async ({
  page,
  request,
}) => {
  const rows = await fixture(page, request);
  await page.setViewportSize({ width: 390, height: 844 });
  let fail = true;
  await page.route(/\/api\/items\/state-\d+$/, async (route) => {
    if (fail) await route.fulfill({ status: 503, json: { error: '详情暂时不可用。' } });
    else await route.fallback();
  });
  await page.goto('/feed');
  await page.getByTestId('item-state-0').click();
  await expect(page.locator('.detail-panel [role="alert"]')).toContainText('详情暂时不可用');
  await page.screenshot({ path: 'work/mobile-detail-error.png' });
  await page.getByRole('button', { name: '返回列表', exact: true }).click();
  await expect(page.getByTestId('item-state-0')).toBeFocused();
  await page.keyboard.press('Enter');
  fail = false;
  await page.getByRole('button', { name: '重试加载详情' }).click();
  await page.getByRole('tab', { name: '原文', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toContainText(
    rows[0].body
      .split('\n')
      .find((line) => line.length > 5)!
      .replace(/^#+\s*/, ''),
  );
  fail = true;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '刷新内容' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.detail-panel [role="alert"]')).toContainText('详情暂时不可用');
  await expect(page.getByRole('tab', { name: '原文', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('tabpanel')).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: '重试加载详情' }).click();
  await expect(page.locator('.detail-panel [role="alert"]')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '原文', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'work/mobile-detail.png' });
});

test('failed save keeps state and body, disables repeated clicks and keyboard popover dismissal works', async ({
  page,
  request,
}) => {
  await fixture(page, request);
  await page.goto('/feed');
  await page.getByTestId('item-state-0').focus();
  await page.keyboard.press('Enter');
  const button = page.getByRole('button', { name: '取消收藏', exact: true });
  await expect(button).toBeEnabled();
  let complete!: () => void;
  const gate = new Promise<void>((resolve) => {
    complete = resolve;
  });
  await page.route('**/api/items/*/state', async (route) => {
    if (route.request().postDataJSON().saved !== undefined) {
      await gate;
      await route.fulfill({ status: 503, json: { error: '收藏未保存，请重试。' } });
    } else await route.fallback();
  });
  await button.click();
  await expect(button).toBeDisabled();
  complete();
  await expect(button).toBeEnabled();
  await expect(page.locator('.detail-title')).toContainText('State 0');
  await expect(page.locator('.toast')).toContainText('收藏未保存');
  const notices = page.getByRole('button', { name: '通知中心', exact: true });
  await notices.click();
  await expect(page.getByRole('dialog', { name: '通知中心' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(notices).toBeFocused();
  await expect(page.getByRole('dialog', { name: '通知中心' })).toHaveCount(0);
  await page.screenshot({ path: 'work/desktop-reader.png' });
});

test('real APIs send a single preview list and load full details only on selection', async ({
  page,
  request,
}) => {
  const initial = await (await request.get('/api/bootstrap')).json();
  expect(initial.feed).not.toHaveProperty('items');
  const result = await (await request.get('/api/feed')).json();
  for (const item of result.items) {
    for (const key of ['body', 'translation', 'translationBlocks', 'contentHash'])
      expect(item).not.toHaveProperty(key);
    if (item.summary) expect(Object.keys(item.summary)).toEqual(['overview']);
  }
  const details: string[] = [];
  page.on('request', (req) => {
    if (/\/api\/items\/[^/?]+$/.test(req.url())) details.push(req.url());
  });
  await page.goto('/feed');
  await expect(page.getByTestId(`item-${result.items[0].id}`)).toBeVisible();
  expect(details).toEqual([]);
  const readResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/items/${result.items[0].id}/state`) &&
      response.request().method() === 'PATCH',
  );
  await page.getByTestId(`item-${result.items[0].id}`).click();
  await expect(page.getByRole('region', { name: '更新详情' })).toBeVisible();
  await page.getByRole('tab', { name: '原文', exact: true }).click();
  await expect(page.getByText('DEMO FIXTURE', { exact: false })).toBeVisible();
  expect(details).toHaveLength(1);
  expect((await readResponse).status()).toBe(200);
});

test('600 loaded previews remain scrollable and search stays responsive', async ({
  page,
  request,
}) => {
  await fixture(page, request, 600);
  await page.goto('/feed');
  await expect(page.locator('.update-card')).toHaveCount(30);
  for (let count = 60; count <= 600; count += 30) {
    await page.getByRole('button', { name: '加载更多更新' }).click();
    await expect(page.locator('.update-card')).toHaveCount(count);
  }
  const frames = await page.getByRole('region', { name: '更新列表' }).evaluate(async (element) => {
    const times: number[] = [];
    let previous = performance.now();
    for (let frame = 0; frame < 36; frame++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const now = performance.now();
      times.push(now - previous);
      previous = now;
      element.scrollTop = ((element.scrollHeight - element.clientHeight) * frame) / 35;
    }
    return times.slice(2).sort((a, b) => a - b);
  });
  const start = Date.now();
  await page.getByLabel('搜索更新').fill('State 599');
  await expect(page.locator('.update-card')).toHaveCount(1);
  await expect(page.getByTestId('item-state-599')).toBeVisible();
  const searchMs = Date.now() - start;
  const p95FrameMs = frames[Math.floor(frames.length * 0.95)];
  await mkdir('work', { recursive: true });
  await writeFile(
    'work/browser-feed-performance.json',
    JSON.stringify({ rows: 600, p95FrameMs, searchMs, frames }, null, 2),
  );
  expect(p95FrameMs).toBeLessThan(120);
  expect(searchMs).toBeLessThan(3000);
});

test('a detail response cannot consume the unread counter delta before its PATCH completes', async ({
  page,
  request,
}) => {
  const rows = await fixture(page, request);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/items/*/state', async (route) => {
    rows[0].read = true;
    await gate;
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto('/feed');
  await expect(page.getByTestId('item-state-0')).toBeVisible();
  await page.getByTestId('item-state-0').click();
  await expect(page.locator('.status-chip')).toHaveText('已读');
  await expect(page.locator('.main-nav button').filter({ hasText: '全部更新' })).toContainText('3');
  release();
  await expect(page.locator('.main-nav button').filter({ hasText: '全部更新' })).toContainText('2');
  await expect(page.getByTestId('item-state-0')).toHaveClass(/read/);
});

test('a pending state survives the 600 to 630 preview cache boundary', async ({
  page,
  request,
}) => {
  test.setTimeout(60000);
  const rows = await fixture(page, request, 630);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/items/*/state', async (route) => {
    rows[0].read = true;
    await gate;
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto('/feed');
  await page.getByRole('button', { name: '分栏阅读', exact: true }).click();
  await expect(page.locator('.update-card')).toHaveCount(30);
  for (let count = 60; count <= 600; count += 30) {
    await page.getByRole('button', { name: '加载更多更新' }).click();
    await expect(page.locator('.update-card')).toHaveCount(count);
  }
  await page.getByTestId('item-state-0').click();
  await expect(page.locator('.status-chip')).toHaveText('已读');
  await page.getByRole('button', { name: '加载更多更新' }).click();
  release();
  await expect(page.locator('.update-card')).toHaveCount(630);
  await expect(page.getByTestId('item-state-0')).toHaveClass(/read/);
  await expect(page.locator('.main-nav button').filter({ hasText: '全部更新' })).toContainText(
    '629',
  );
});

test('background polls fetch metadata and announce arrivals without replacing the list', async ({
  page,
  request,
}) => {
  await page.clock.install();
  const rows = await fixture(page, request);
  await page.route('**/api/bootstrap*', async (route) => {
    const data = await (await route.fetch()).json();
    await route.fulfill({ json: { ...data, jobs: [] } });
  });
  await page.goto('/feed');
  await expect(page.locator('.update-card')).toHaveCount(3);
  rows.unshift({ ...rows[0], id: 'state-new', title: 'A newly arrived update' });
  const urls: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/')) urls.push(req.url());
  });
  await page.clock.fastForward(31000);
  await expect(page.getByRole('button', { name: '查看最新更新' })).toBeVisible();
  await expect(page.locator('.update-card')).toHaveCount(3);
  await expect(page.getByTestId('item-state-new')).toHaveCount(0);
  expect(urls.some((url) => url.includes('/api/bootstrap?metadata=true'))).toBe(true);
  expect(
    urls.filter((url) => url.includes('/api/feed?')).every((url) => url.includes('status=true')),
  ).toBe(true);
  await page.getByRole('button', { name: '查看最新更新' }).click();
  await expect(page.getByTestId('item-state-new')).toBeVisible();
  await expect(page.locator('.update-card')).toHaveCount(4);
});

test('global counters survive leaving the feed and selected filtered-out details refresh', async ({
  page,
  request,
}) => {
  const rows = await fixture(page, request);
  await page.goto('/feed');
  await expect(page.getByTestId('item-state-0')).toBeVisible();
  await page.getByRole('button', { name: '未读', exact: true }).click();
  await page.getByTestId('item-state-0').click();
  await expect(page.getByTestId('item-state-0')).toHaveCount(0);
  await expect(page.locator('.main-nav button').filter({ hasText: '全部更新' })).toContainText('2');
  rows[0].summary = {
    ...rows[0].summary!,
    headline: 'Fresh detail headline',
    overview: 'Fresh worker result',
  };
  await page.getByRole('button', { name: '刷新内容' }).click();
  await expect(page.getByText('Fresh worker result', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '更多工具', exact: true }).click();
  await page.getByRole('button', { name: '今日精选', exact: true }).click();
  await expect(page.locator('.main-nav button').filter({ hasText: '全部更新' })).toContainText('2');
});

test('bulk read is enabled when unread rows exist only on an unloaded page', async ({
  page,
  request,
}) => {
  const rows = await fixture(page, request, 31);
  rows.slice(0, 30).forEach((item) => {
    item.read = true;
  });
  let called = false;
  await page.route('**/api/feed/read', async (route) => {
    called = true;
    rows.forEach((item) => {
      item.read = true;
    });
    await route.fulfill({ json: { changed: 1 } });
  });
  await page.goto('/feed');
  await expect(page.locator('.update-card')).toHaveCount(30);
  const bulk = page.getByRole('button', { name: '当前筛选全部标为已读' });
  await expect(bulk).toBeEnabled();
  await bulk.click();
  await expect(bulk).toBeDisabled();
  expect(called).toBe(true);
});

test('a delayed read mutation cannot strand a newly selected filter', async ({ page, request }) => {
  const rows = await fixture(page, request);
  let releaseRead!: () => void;
  const readGate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  await page.route('**/api/items/*/state', async (route) => {
    await readGate;
    rows[0].read = true;
    await route.fulfill({ json: { ok: true } });
  });
  let releaseFeed!: () => void;
  const feedGate = new Promise<void>((resolve) => {
    releaseFeed = resolve;
  });
  let filteredRequests = 0;
  await page.route('**/api/feed?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('unread') === 'true') {
      filteredRequests++;
      await feedGate;
    }
    await route.fallback();
  });
  await page.goto('/feed');
  await page.getByRole('button', { name: '分栏阅读', exact: true }).click();
  await expect(page.getByTestId('item-state-0')).toBeVisible();
  await page.getByTestId('item-state-0').click();
  await page.getByRole('button', { name: '未读', exact: true }).click();
  await expect.poll(() => filteredRequests).toBe(1);
  releaseRead();
  await expect.poll(() => filteredRequests).toBe(2);
  releaseFeed();
  await expect(page.locator('.update-card')).toHaveCount(2);
  await expect(page.getByTestId('item-state-0')).toHaveCount(0);
});

test('refresh waiting on item A cannot invalidate the newly selected item B detail request', async ({
  page,
  request,
}) => {
  const rows = await fixture(page, request);
  let releaseA!: () => void;
  const readGate = new Promise<void>((resolve) => {
    releaseA = resolve;
  });
  await page.route('**/api/items/state-0/state', async (route) => {
    await readGate;
    rows[0].read = true;
    await route.fulfill({ json: { ok: true } });
  });
  let releaseB!: () => void;
  const detailGate = new Promise<void>((resolve) => {
    releaseB = resolve;
  });
  let bRequested = false;
  await page.route('**/api/items/state-1', async (route) => {
    bRequested = true;
    await detailGate;
    await route.fulfill({ json: rows[1] });
  });
  await page.goto('/feed');
  await page.getByRole('button', { name: '分栏阅读', exact: true }).click();
  await page.getByTestId('item-state-0').click();
  await expect(page.locator('.detail-title')).toHaveText('State 0');
  const metadata = page.waitForResponse((r) => r.url().endsWith('/api/bootstrap'));
  await page.getByRole('button', { name: '刷新内容' }).click();
  await metadata;
  // The refresh has received metadata but must still wait for A's pending mutation.
  await page.waitForTimeout(100);
  await page.getByTestId('item-state-1').click();
  await expect.poll(() => bRequested).toBe(true);
  releaseA();
  await expect(page.getByTestId('item-state-0')).toHaveClass(/read/);
  releaseB();
  await expect(page.locator('.detail-title')).toHaveText('State 1');
  await expect(page.locator('.detail-panel')).not.toContainText('正在加载更新详情');
});
