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
  await feed.getByRole('button', { name: /v1\.0 正式发布/ }).click();
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
  await feed.getByRole('button', { name: /v1\.0 正式发布/ }).click();
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

test('following import pages preserve selections and mark existing authors', async ({ page }) => {
  let imported = false;
  await page.route('**/api/github/following/preview', async (route) => {
    const body = route.request().postDataJSON() as { page: number };
    const pageNumber = body.page ?? 1;
    await route.fulfill({
      json:
        pageNumber === 1
          ? {
              username: 'alice-owner',
              page: 1,
              nextPage: 2,
              truncated: true,
              users: [
                { id: 'author-1', login: 'alice', subscribed: false },
                { id: 'author-2', login: 'bob', subscribed: true },
              ],
            }
          : {
              username: 'alice-owner',
              page: 2,
              nextPage: null,
              truncated: false,
              users: [{ id: 'author-3', login: 'charlie', subscribed: false }],
            },
    });
  });
  await page.route('**/api/github/following/import', async (route) => {
    imported = true;
    await route.fulfill({
      json: {
        added: [{ name: 'alice' }, { name: 'charlie' }],
        failed: [],
      },
    });
  });
  await page.goto('/subscriptions');
  await page.getByRole('button', { name: '刷新内容' }).click();
  await page.getByRole('button', { name: '添加订阅', exact: true }).first().click();
  await page.getByRole('button', { name: '导入关注', exact: true }).click();
  await page.getByLabel('GitHub 用户名（可选）', { exact: true }).fill('alice-owner');
  await page.getByRole('button', { name: '查看关注列表', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '订阅 alice', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: '订阅 bob', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: '订阅 bob', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: '订阅 alice', exact: true }).uncheck();
  await page.getByRole('button', { name: '加载更多关注', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '订阅 charlie', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: '订阅 alice', exact: true })).not.toBeChecked();
  await page.getByRole('checkbox', { name: '订阅 alice', exact: true }).check();
  await page.getByRole('button', { name: '导入 2 人', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(imported).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('following import explains the author subscription limit before selection', async ({ page }) => {
  await page.route('**/api/bootstrap', async (route) => {
    const data: Bootstrap = await (await route.fetch()).json();
    const template = data.subscriptions[0];
    const authors = Array.from({ length: 50 }, (_, index) => ({
      ...template,
      id: `author-limit-${index}`,
      kind: 'author' as const,
      name: `author-${index}`,
      externalId: String(index),
    }));
    await route.fulfill({ json: { ...data, subscriptions: authors } });
  });
  await page.route('**/api/github/following/preview', async (route) =>
    route.fulfill({
      json: {
        username: 'alice-owner',
        page: 1,
        nextPage: null,
        truncated: false,
        users: [{ id: 'new-author', login: 'new-author', subscribed: false }],
      },
    }),
  );
  await page.goto('/subscriptions');
  await page.getByRole('button', { name: '刷新内容' }).click();
  await page.getByRole('button', { name: '添加订阅', exact: true }).first().click();
  await page.getByRole('button', { name: '导入关注', exact: true }).click();
  await expect(page.getByText('作者订阅上限：50 个，当前还可添加 0 个。', { exact: true })).toBeVisible();
  await page.getByLabel('GitHub 用户名（可选）', { exact: true }).fill('alice-owner');
  await page.getByRole('button', { name: '查看关注列表', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '订阅 new-author', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '导入 0 人', exact: true })).toBeDisabled();
});

test('following import keeps the dialog open for failed accounts after partial success', async ({ page }) => {
  let importCount = 0;
  await page.route('**/api/github/following/preview', async (route) =>
    route.fulfill({
      json: {
        username: 'alice-owner',
        page: 1,
        nextPage: null,
        truncated: false,
        users: [
          { id: 'author-1', login: 'alice', subscribed: false },
          { id: 'author-2', login: 'bob', subscribed: false },
        ],
      },
    }),
  );
  await page.route('**/api/github/following/import', async (route) => {
    importCount += 1;
    await route.fulfill({
      json:
        importCount === 1
          ? {
              added: [{ name: 'alice' }],
              failed: [{ name: 'bob', error: '账号不存在' }],
            }
          : { added: [{ name: 'bob' }], failed: [] },
    });
  });
  await page.goto('/subscriptions');
  await page.getByRole('button', { name: '添加订阅', exact: true }).first().click();
  await page.getByRole('button', { name: '导入关注', exact: true }).click();
  await page.getByLabel('GitHub 用户名（可选）', { exact: true }).fill('alice-owner');
  await page.getByRole('button', { name: '查看关注列表', exact: true }).click();
  await page.getByRole('button', { name: '导入 2 人', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('bob（账号不存在）');
  await expect(page.getByRole('checkbox', { name: '订阅 alice', exact: true })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: '订阅 bob', exact: true })).toBeChecked();
  await page.getByRole('button', { name: '导入 1 人', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
});
