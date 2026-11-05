import { expect, test } from '@playwright/test';
import { mockReaderBootstrap } from './reader-fixtures';

for (const width of [320, 390, 768, 1440, 1920]) {
  test(`feed stays readable without overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await mockReaderBootstrap(page, (data) => data);
    await page.goto('/feed');
    const card = page.locator('.update-card').first();
    await expect(card).toBeVisible();
    const metrics = await page.evaluate(() => {
      const card = document.querySelector<HTMLElement>('.update-card')!;
      const feed = document.querySelector<HTMLElement>('.feed-panel')!;
      const fontSize = (selector: string) =>
        parseFloat(getComputedStyle(document.querySelector(selector)!).fontSize);
      return {
        title: fontSize('.update-card h2'),
        description: fontSize('.update-card > p'),
        time: fontSize('.card-time'),
        search: fontSize('.search-box input'),
        cardWidth: card.getBoundingClientRect().width,
        feedWidth: feed.getBoundingClientRect().width,
        firstCardTop: card.getBoundingClientRect().top,
        documentFits: document.documentElement.scrollWidth <= window.innerWidth,
        feedFits: feed.scrollWidth <= feed.clientWidth + 1,
      };
    });
    expect(metrics.title).toBeGreaterThanOrEqual(17);
    expect(metrics.description).toBeGreaterThanOrEqual(15);
    expect(metrics.time).toBeGreaterThanOrEqual(12);
    expect(metrics.search).toBeGreaterThanOrEqual(16);
    expect(metrics.documentFits).toBe(true);
    expect(metrics.feedFits).toBe(true);
    if (width >= 1440) {
      expect(metrics.cardWidth / metrics.feedWidth).toBeGreaterThan(0.75);
      expect(metrics.firstCardTop).toBeLessThan(380);
    }
    if (width < 768) expect(metrics.firstCardTop).toBeLessThan(450);
    const search = await page.locator('.search-box').boundingBox();
    const layout = await page.getByRole('group', { name: '阅读布局' }).boundingBox();
    expect(search!.x + search!.width).toBeLessThanOrEqual(layout!.x);
    await page.screenshot({ path: `output/playwright/readability/feed-${width}.png` });
  });
}

test('long mixed-platform rows fit both layouts and filters remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockReaderBootstrap(
    page,
    (data) => data,
    (items) =>
      items.map((item) => ({
        ...item,
        platform: 'youtube',
        type: 'video' as const,
        repo: 'long-channel-name-without-spaces'.repeat(4),
        title: '一个较长的视频标题：聚合阅读器在多平台内容混合时如何保持清晰的阅读体验 '.repeat(3),
        description: '频道公开简介，用于检查较长文字换行和缩略图排版。'.repeat(5),
        summary: null,
        media: {
          kind: 'video' as const,
          content: 'description' as const,
          thumbnailUrl: 'https://i.ytimg.com/vi/readability/hqdefault.jpg',
        },
      })),
  );
  await page.route('https://i.ytimg.com/vi/readability/hqdefault.jpg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#e5e9ef"/></svg>',
    }),
  );
  await page.goto('/feed');
  await expect(page.locator('.video-thumbnail').first()).toBeVisible();
  await page
    .getByRole('group', { name: '平台筛选' })
    .getByRole('button', { name: 'YouTube' })
    .click();
  await page
    .getByRole('group', { name: '内容类型' })
    .getByRole('button', { name: '新视频' })
    .click();
  await expect(page.locator('.update-card').first()).toBeVisible();
  const title = page.locator('.update-card h2').first();
  const titleMetrics = await title.evaluate((el) => ({
    height: el.getBoundingClientRect().height,
    lineHeight: parseFloat(getComputedStyle(el).lineHeight),
  }));
  expect(titleMetrics.height).toBeLessThanOrEqual(titleMetrics.lineHeight * 2 + 1);
  await expect(title).toHaveAttribute('title', /一个较长的视频标题/);
  await page.screenshot({ path: 'output/playwright/readability/long-video-list.png' });
  await page.getByRole('button', { name: '分栏阅读', exact: true }).click();
  await expect(page.locator('.reader-grid')).toHaveClass(/split-layout/);
  expect(
    await page.locator('.feed-panel').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  await page.screenshot({ path: 'output/playwright/readability/long-video-split.png' });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole('button', { name: '列表布局', exact: true }).click();
  await expect(page.locator('.video-thumbnail').first()).toBeVisible();
  expect(
    await page.locator('.feed-panel').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  await page.screenshot({ path: 'output/playwright/readability/long-video-mobile.png' });
});

test('compact preference keeps descriptions hidden with readable titles', async ({ page }) => {
  await mockReaderBootstrap(page, (data) => ({
    ...data,
    preferences: { ...data.preferences, compact: true },
  }));
  await page.goto('/feed');
  await page.getByRole('button', { name: '刷新内容' }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/compact/);
  await expect(page.locator('.update-card > p').first()).toBeHidden();
  await expect(page.locator('.update-card h2').first()).toHaveCSS('font-size', '18px');
});
