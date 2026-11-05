import { expect, test } from '@playwright/test';
import type { Bootstrap, Subscription } from '../../src/shared/types';
import { mockReaderBootstrap } from './reader-fixtures';

test('one release appears under both project and followed author with explicit coverage and mobile layout', async ({
  page,
}) => {
  const errors: string[] = [];
  let subscribedRepository = '';
  page.on('pageerror', (error) => errors.push(error.message));
  await mockReaderBootstrap(page, (data) => {
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
      contentUrl: 'https://github.com/alice/new/blob/HEAD/README.md',
      matchedSources: [{ id: author.id, kind: author.kind, name: author.name }],
    };
    return { ...data, jobs: [], subscriptions: [project, author], items: [shared, authorOnly] };
  });
  await page.route('**/api/subscriptions', async (route) => {
    if (route.request().method() === 'POST') {
      subscribedRepository = (route.request().postDataJSON() as { input: string }).input;
      await route.fulfill({ json: { id: 'new-repository-subscription' } });
      return;
    }
    await route.continue();
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
  await feed.getByRole('button', { name: /作者的新项目/ }).click();
  await expect(page.getByRole('link', { name: '查看正文来源', exact: true })).toHaveAttribute(
    'href',
    'https://github.com/alice/new/blob/HEAD/README.md',
  );
  await expect(page.getByRole('button', { name: '订阅项目更新', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '订阅项目更新', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('项目订阅已添加');
  expect(subscribedRepository).toBe('alice/new');
  await page.getByRole('button', { name: '返回列表', exact: true }).click();
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
        added: [{ name: 'alice-before-rename' }, { name: 'charlie' }],
        accepted: ['alice', 'charlie'],
        receipt: { created: 1, existing: 1, failed: 0 },
        failed: [],
      },
    });
  });
  await page.goto('/subscriptions');
  await page.getByRole('button', { name: '刷新内容' }).click();
  await page.getByRole('button', { name: '添加订阅', exact: true }).first().click();
  await page.getByRole('tab', { name: '导入关注', exact: true }).click();
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
  await expect(page.getByRole('dialog').getByRole('status')).toContainText(
    '本次新增 1 位作者，已存在 1 个，失败 0 个',
  );
  await expect(page.getByRole('checkbox', { name: '订阅 alice', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(imported).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const mode of ['lost-response', 'refresh-failed'] as const) {
  test(`following import recovers at full capacity after ${mode}`, async ({ page }) => {
    await page.clock.install();
    const stored: Subscription[] = [];
    let template: Subscription;
    await mockReaderBootstrap(page, (data) => {
      template = data.subscriptions[0];
      return {
        ...data,
        subscriptions: [
          ...Array.from({ length: 49 }, (_, index) => ({
            ...template,
            id: `existing-author-${index}`,
            externalId: `existing-author-${index}`,
            kind: 'author' as const,
          })),
          ...stored,
        ],
      };
    });
    await page.route('**/api/github/following/preview', (route) =>
      route.fulfill({
        json: {
          username: 'owner',
          page: 1,
          nextPage: null,
          truncated: false,
          users: [{ id: 'last-author', login: 'last-author', subscribed: false }],
        },
      }),
    );
    let calls = 0;
    await page.route('**/api/github/following/import', async (route) => {
      expect(route.request().postDataJSON()).toEqual({ usernames: ['last-author'] });
      calls++;
      if (!stored.length)
        stored.push({
          ...template,
          id: 'last-author',
          externalId: 'last-author',
          kind: 'author',
          name: 'last-author',
        });
      if (mode === 'lost-response' && calls === 1) return route.abort('failed');
      if (mode === 'refresh-failed') {
        await page.route('**/api/bootstrap*', (refresh) => refresh.abort('failed'));
      }
      return route.fulfill({
        json: {
          added: stored,
          accepted: ['last-author'],
          failed: [],
          receipt: { created: calls === 1 ? 1 : 0, existing: calls === 1 ? 0 : 1, failed: 0 },
        },
      });
    });
    await page.goto('/subscriptions');
    await page.getByRole('button', { name: '刷新内容' }).click();
    await page.getByRole('button', { name: '添加订阅', exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: '导入关注', exact: true }).click();
    await dialog.getByRole('button', { name: '查看关注列表', exact: true }).click();
    await dialog.getByRole('button', { name: '导入 1 人', exact: true }).click();
    if (mode === 'lost-response') {
      await expect(dialog.getByRole('alert')).toContainText('暂时无法连接服务');
      await page.clock.fastForward(31000);
      await expect(dialog.getByText('作者订阅上限：50 个，当前还可添加 0 个。')).toBeVisible();
      await expect(dialog.getByRole('button', { name: '导入 1 人', exact: true })).toBeEnabled();
      await dialog.getByRole('button', { name: '导入 1 人', exact: true }).click();
      await expect(dialog.getByRole('status')).toContainText('本次新增 0 位作者，已存在 1 个');
    } else {
      await expect(dialog.getByRole('alert')).toContainText('订阅已保存，但页面刷新失败');
      await expect(dialog.getByText('作者订阅上限：50 个，当前还可添加 0 个。')).toBeVisible();
    }
    await expect(
      dialog.getByRole('checkbox', { name: '订阅 last-author', exact: true }),
    ).toBeDisabled();
    expect(stored).toHaveLength(1);
    expect(calls).toBe(mode === 'lost-response' ? 2 : 1);
    await page.unrouteAll({ behavior: 'wait' });
  });
}

test('following import explains the author subscription limit before selection', async ({
  page,
}) => {
  await page.route('**/api/bootstrap*', async (route) => {
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
  await page.getByRole('tab', { name: '导入关注', exact: true }).click();
  await expect(
    page.getByText('作者订阅上限：50 个，当前还可添加 0 个。', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('GitHub 用户名（可选）', { exact: true }).fill('alice-owner');
  await page.getByRole('button', { name: '查看关注列表', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '订阅 new-author', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '导入 0 人', exact: true })).toBeDisabled();
});

test('following import keeps the dialog open for failed accounts after partial success', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
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
  await page.getByRole('tab', { name: '导入关注', exact: true }).click();
  await page.getByLabel('GitHub 用户名（可选）', { exact: true }).fill('alice-owner');
  await page.getByRole('button', { name: '查看关注列表', exact: true }).click();
  await page.getByRole('button', { name: '导入 2 人', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('bob（账号不存在）');
  await expect(page.getByRole('checkbox', { name: '订阅 alice', exact: true })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: '订阅 bob', exact: true })).toBeChecked();
  await page.getByRole('button', { name: '导入 1 人', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('本次新增 1 位作者');
  await expect(page.getByRole('dialog').getByRole('status')).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: '完成', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
});
