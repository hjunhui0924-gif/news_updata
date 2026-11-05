import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { mockReaderBootstrap } from './reader-fixtures';
import type { FeedItem } from '../../src/shared/types';

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 375, height: 812 },
  { width: 320, height: 568 },
  { width: 844, height: 390 },
]) {
  test(`subscription dialog stays stable across methods at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/subscriptions');
    await page.locator('.management-heading').getByRole('button', { name: '添加订阅' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const original = await dialog.boundingBox();
    expect(original).not.toBeNull();
    for (const name of [
      '搜索项目',
      '导入 Star',
      '开发者',
      '导入关注',
      'YouTube 关注',
      '项目仓库',
    ]) {
      await dialog.getByRole('tab', { name, exact: true }).click();
      const bounds = await dialog.boundingBox();
      expect(Math.abs(bounds!.height - original!.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(bounds!.width - original!.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(bounds!.y - original!.y)).toBeLessThanOrEqual(1);
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
      expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    }
    await mkdir('work/reader-polish', { recursive: true });
    await page.screenshot({ path: `work/reader-polish/dialog-${viewport.width}.png` });
    await dialog.getByRole('tab', { name: '项目仓库', exact: true }).press('End');
    await expect(dialog.getByRole('tab', { name: 'YouTube 关注' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });
}

test('subscription sources collapse, show all-paused state, and remain keyboard accessible', async ({
  page,
}) => {
  await mockReaderBootstrap(page, (data) => ({
    ...data,
    subscriptions: data.subscriptions.map((sub) => ({ ...sub, enabled: false })),
  }));
  await page.goto('/feed');
  const refreshed = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/bootstrap',
  );
  await page.getByRole('button', { name: '刷新内容' }).click();
  await refreshed;
  const sidebar = page.locator('.app-shell > .sidebar');
  const toggle = sidebar.getByRole('button', { name: '订阅来源', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(sidebar.getByRole('navigation', { name: '订阅来源' })).toBeHidden();
  await toggle.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(sidebar.getByText('订阅已全部暂停，可在订阅管理中恢复。')).toBeVisible();
  await toggle.press('Space');
  await expect(sidebar.getByRole('navigation', { name: '订阅来源' })).toBeHidden();
});

test('video description offers literal bilingual reading without a summary or background translation', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let translationRequests = 0;
  await page.route('**/api/items/*/translation', async (route) => {
    translationRequests++;
    await route.fulfill({ json: { status: 'pending' } });
  });
  const original =
    '# This is a description\n<script>alert("example")</script>\nhttps://example.com/watch';
  const translated = '# 这是一段简介\n<script>示例文字</script>\nhttps://example.com/watch';
  const video = (item: FeedItem) => ({
    ...item,
    platform: 'youtube' as const,
    type: 'video' as const,
    demo: false,
    language: 'en' as const,
    body: original,
    summary: null,
    translation: translated,
    translationBlocks: [{ original, translation: translated }],
  });
  await mockReaderBootstrap(
    page,
    (data) => ({ ...data, items: data.items.map((item, i) => (i === 0 ? video(item) : item)) }),
    (items) => items.map((item, i) => (i === 0 ? video(item) : item)),
  );
  await page.goto('/feed');
  await page.getByTestId('item-demo-item-0').click();
  await expect(page.getByRole('tab', { name: '视频简介', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('tab', { name: '中文摘要' })).toHaveCount(0);
  await page.getByRole('tab', { name: '简介对照翻译' }).click();
  await expect(page.getByRole('tabpanel')).toContainText(original);
  await expect(page.getByRole('tabpanel')).toContainText(translated);
  await expect(page.getByRole('tabpanel').locator('script, h1')).toHaveCount(0);
  expect(translationRequests).toBe(0);
  await mkdir('work/reader-polish', { recursive: true });
  await page.screenshot({ path: 'work/reader-polish/video-bilingual-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir('work/reader-polish', { recursive: true });
  await page.screenshot({ path: 'work/reader-polish/video-bilingual-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

for (const scenario of ['empty', 'chinese', 'long', 'disabled'] as const) {
  test(`video description translation handles ${scenario} without submitting a task`, async ({
    page,
  }) => {
    let requests = 0;
    await page.route('**/api/items/*/translation', async (route) => {
      requests++;
      await route.fulfill({ json: { status: 'pending' } });
    });
    const body =
      scenario === 'empty'
        ? ' \n '
        : scenario === 'chinese'
          ? '这是一段中文简介。'
          : scenario === 'long'
            ? 'Read more. '.repeat(1601)
            : 'Read more about this video.';
    const video = (item: FeedItem) => ({
      ...item,
      platform: 'youtube' as const,
      type: 'video' as const,
      demo: false,
      language: scenario === 'chinese' ? ('zh' as const) : ('en' as const),
      body,
      summary: null,
      translation: null,
      translationBlocks: null,
    });
    await mockReaderBootstrap(
      page,
      (data) => ({
        ...data,
        services: { ...data.services, ai: scenario !== 'disabled' },
        items: data.items.map((item, i) => (i === 0 ? video(item) : item)),
      }),
      (items) => items.map((item, i) => (i === 0 ? video(item) : item)),
    );
    await page.goto('/feed');
    await page.getByRole('button', { name: '刷新内容' }).click();
    await page.getByTestId('item-demo-item-0').click();
    await page.getByRole('tab', { name: '简介对照翻译' }).click();
    const panel = page.getByRole('tabpanel');
    if (scenario === 'empty') await expect(panel.getByText('该视频没有公开简介')).toBeVisible();
    if (scenario === 'chinese')
      await expect(panel.getByText('简介已是中文，无需翻译。')).toBeVisible();
    if (scenario === 'long') await expect(panel.getByText('简介超过 16000 字符')).toBeVisible();
    if (scenario === 'disabled') {
      await expect(panel.getByText('AI 服务当前关闭', { exact: false })).toBeVisible();
      await expect(panel.getByRole('button', { name: '翻译视频简介' })).toBeDisabled();
    } else await expect(panel.getByRole('button', { name: '翻译视频简介' })).toHaveCount(0);
    expect(requests).toBe(0);
  });
}

test('video translation failure can retry while pending work blocks duplicate submissions', async ({
  page,
}) => {
  let requests = 0;
  let pending = false;
  const video = (item: FeedItem) => ({
    ...item,
    platform: 'youtube' as const,
    type: 'video' as const,
    demo: false,
    language: 'en' as const,
    body: 'Read more about this video.',
    summary: null,
    translation: null,
    translationBlocks: null,
  });
  await mockReaderBootstrap(
    page,
    (data) => ({
      ...data,
      services: { ...data.services, ai: true },
      jobs: pending
        ? [
            {
              id: 'video-translation-job',
              kind: 'translation',
              targetId: 'demo-item-0',
              status: 'pending',
              error: null,
              createdAt: new Date().toISOString(),
            },
          ]
        : [],
      items: data.items.map((item, i) => (i === 0 ? video(item) : item)),
    }),
    (items) => items.map((item, i) => (i === 0 ? video(item) : item)),
  );
  await page.route('**/api/items/*/translation', async (route) => {
    requests++;
    if (requests === 1)
      await route.fulfill({ status: 503, json: { error: '翻译服务暂时不可用，请稍后重试。' } });
    else {
      pending = true;
      await route.fulfill({ json: { status: 'pending' } });
    }
  });
  await page.goto('/feed');
  await page.getByRole('button', { name: '刷新内容' }).click();
  await page.getByTestId('item-demo-item-0').click();
  await page.getByRole('tab', { name: '简介对照翻译' }).click();
  const button = page.getByRole('button', { name: '翻译视频简介' });
  expect(requests).toBe(0);
  await button.click();
  await expect(page.getByRole('status').filter({ hasText: '翻译服务暂时不可用' })).toBeVisible();
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button).toBeDisabled();
  await expect(page.getByRole('heading', { name: '翻译任务正在处理…' })).toBeVisible();
  await page.getByRole('tab', { name: '视频简介', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toContainText('Read more about this video.');
  expect(requests).toBe(2);
});
