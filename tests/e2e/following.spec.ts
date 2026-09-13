import { expect, test } from '@playwright/test';
import type { Bootstrap } from '../../src/shared/types';

test('one release appears under both project and followed author with explicit coverage and mobile layout', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/bootstrap', async (route) => {
    const data: Bootstrap = await (await route.fetch()).json();
    const project = {
      ...data.subscriptions[0],
      id: 'source-project',
      kind: 'repo' as const,
      name: 'organization/tool',
      description: '项目订阅',
      enabled: true,
    };
    const author = {
      ...data.subscriptions[1],
      id: 'source-author',
      kind: 'author' as const,
      name: 'alice',
      description: '开发者',
      enabled: true,
      authorEventWindowCapped: true,
    };
    const shared = {
      ...data.items[0],
      sourceId: project.id,
      sourceIds: [project.id, author.id],
      repo: project.name,
      title: 'v1.0 正式发布',
      type: 'release' as const,
      matchedSources: [
        { id: project.id, kind: project.kind, name: project.name },
        { id: author.id, kind: author.kind, name: author.name },
      ],
    };
    const authorOnly = {
      ...data.items[1],
      sourceId: author.id,
      sourceIds: [author.id],
      type: 'new_repo' as const,
      repo: 'alice/new',
      title: '作者的新项目',
      matchedSources: [{ id: author.id, kind: author.kind, name: author.name }],
    };
    await route.fulfill({
      json: { ...data, jobs: [], subscriptions: [project, author], items: [shared, authorOnly] },
    });
  });
  await page.goto('/subscriptions');
  await page.getByRole('button', { name: '刷新内容' }).click();
  const authorCard = page
    .getByRole('article')
    .filter({ has: page.getByRole('link', { name: 'alice', exact: true }) });
  await expect(authorCard.getByText('跟踪：新建公开项目 · 本人发布的正式版本')).toBeVisible();
  await expect(
    authorCard.getByText('公开活动已达到 300 条窗口上限', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText('GitHub 可能延迟 30 秒至 6 小时', { exact: false })).toBeVisible();
  await authorCard.getByRole('button', { name: '查看更新' }).click();
  const feed = page.getByRole('region', { name: '更新列表' });
  await expect(feed.getByRole('heading', { name: 'v1.0 正式发布', exact: true })).toHaveCount(1);
  await expect(feed.getByRole('heading', { name: '作者的新项目', exact: true })).toBeVisible();
  await feed.getByTestId('item-demo-item-0').click();
  const detail = page.getByRole('region', { name: '更新详情' });
  await expect(detail.getByText('订阅项目 · organization/tool')).toBeVisible();
  await expect(detail.getByText('关注博主 · alice')).toBeVisible();
  await page.screenshot({ path: 'work/following-desktop.png', fullPage: true });
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '订阅管理' })
    .click();
  const projectCard = page
    .getByRole('article')
    .filter({ has: page.getByRole('link', { name: 'organization/tool', exact: true }) });
  await projectCard.getByRole('button', { name: '查看更新' }).click();
  await expect(feed.getByRole('heading', { name: 'v1.0 正式发布', exact: true })).toHaveCount(1);
  await expect(feed.getByRole('heading', { name: '作者的新项目', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 960 });
  await feed.getByTestId('item-demo-item-0').click();
  await expect(detail.getByText('关注博主 · alice')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'work/following-mobile.png', fullPage: true });
  await page
    .getByRole('navigation', { name: '移动导航' })
    .getByRole('button', { name: '订阅', exact: true })
    .click();
  await expect(authorCard.getByRole('button', { name: '查看更新' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'work/following-subscriptions-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});
