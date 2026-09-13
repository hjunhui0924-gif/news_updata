import { test, expect } from '@playwright/test';
import type { Job, StarSyncStatus } from '../../src/shared/types';

const repo = (id: number, subscribed = false) => ({
  id: String(id),
  name: `example/repo-${id}`,
  description: 'A repository for testing starred import',
  url: `https://github.com/example/repo-${id}`,
  subscribed,
});
test('automatic Star tracking shows check progress, completion, toggle failures and offline state on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let status: StarSyncStatus = {
    enabled: true,
    nextSyncAt: new Date(Date.now() + 300000).toISOString(),
    lastSyncAt: new Date().toISOString(),
    lastAdded: 0,
    nextPage: 1,
    error: null,
    intervalMinutes: 5,
  };
  let jobs: Job[] = [];
  let failToggle = true;
  let online = true;
  let checks = 0;
  await page.route('**/api/bootstrap', async (route) => {
    const original = await (await route.fetch()).json();
    await route.fulfill({
      json: {
        ...original,
        starSync: status,
        jobs,
        services: { ...original.services, workerOnline: online },
      },
    });
  });
  await page.route('**/api/github/starred/auto', async (route) => {
    if (route.request().method() === 'PATCH') {
      if (failToggle) {
        await route.fulfill({ status: 503, json: { error: '暂时无法保存设置' } });
        return;
      }
      status = { ...status, enabled: route.request().postDataJSON().enabled };
      await route.fulfill({ json: status });
    } else {
      checks++;
      jobs = [
        {
          id: 'auto-test',
          kind: 'stars',
          targetId: 'user',
          status: 'pending',
          error: null,
          createdAt: new Date().toISOString(),
        },
      ];
      await route.fulfill({ json: jobs[0] });
    }
  });
  await page.goto('/subscriptions');
  await page.getByRole('button', { name: '刷新内容' }).click();
  const toggle = page.getByRole('switch', { name: 'Star 自动跟踪' });
  await expect(toggle).toBeChecked();
  await page.getByRole('button', { name: '立即检查', exact: true }).click();
  await expect(page.getByRole('button', { name: '检查中…', exact: true })).toBeDisabled();
  expect(checks).toBe(1);
  jobs = [];
  status = { ...status, lastAdded: 1 };
  await page.getByRole('button', { name: '刷新内容' }).click();
  await expect(page.getByText('上次检查新增 1 个订阅')).toBeVisible();
  await toggle.click();
  await expect(page.getByRole('status').filter({ hasText: '暂时无法保存设置' })).toBeVisible();
  await expect(toggle).toBeChecked();
  failToggle = false;
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByRole('button', { name: '立即检查', exact: true })).toBeDisabled();
  await toggle.click();
  await expect(toggle).toBeChecked();
  online = false;
  status = { ...status, error: 'GitHub 暂时限制请求，请稍后重试。' };
  await page.getByRole('button', { name: '刷新内容' }).click();
  await expect(
    page.getByRole('region', { name: 'Star 自动跟踪' }).getByRole('alert'),
  ).toContainText('GitHub 暂时限制请求');
  await expect(page.getByText('后台同步服务未连接，恢复后会继续检查。')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'work/star-auto-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('star selection, pagination and partial failure preserve successful imports', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let imports = 0;
  let releaseImport: () => void = () => {};
  const importGate = new Promise<void>((resolve) => {
    releaseImport = resolve;
  });
  await page.route('**/api/github/starred/preview', async (route) => {
    const input = route.request().postDataJSON();
    expect(input.username ?? '').toBe(input.page === 1 ? '' : 'my-account');
    await route.fulfill({
      json: {
        username: 'my-account',
        repositories: input.page === 1 ? [repo(1, true), repo(2)] : [repo(2), repo(3)],
        nextPage: input.page === 1 ? 2 : null,
      },
    });
  });
  await page.route('**/api/github/starred/import', async (route) => {
    imports++;
    if (imports === 1) await importGate;
    expect(route.request().postDataJSON().repositories).toEqual(
      imports === 1 ? ['example/repo-2', 'example/repo-3'] : ['example/repo-3'],
    );
    await route.fulfill({
      json:
        imports === 1
          ? {
              added: [{ externalId: '2', name: 'example/repo-2' }],
              failed: [{ name: 'example/repo-3', error: '暂时限流' }],
            }
          : { added: [{ externalId: '3', name: 'example/repo-3' }], failed: [] },
    });
  });
  await page.goto('/subscriptions');
  await page.getByRole('button', { name: '添加订阅', exact: true }).first().click();
  await page.getByRole('button', { name: '导入 Star', exact: true }).click();
  await page.getByRole('button', { name: '读取 Star 列表' }).click();
  await expect(
    page.getByRole('checkbox', { name: '订阅 example/repo-1', exact: true }),
  ).toBeDisabled();
  await page.getByRole('checkbox', { name: '订阅 example/repo-2', exact: true }).uncheck();
  await page.getByRole('button', { name: '加载更多 Star' }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(3);
  await expect(
    page.getByRole('checkbox', { name: '订阅 example/repo-2', exact: true }),
  ).not.toBeChecked();
  await page.getByRole('checkbox', { name: '订阅 example/repo-2', exact: true }).check();
  await page.getByRole('button', { name: '取消全选', exact: true }).click();
  await expect(page.getByRole('button', { name: '导入 0 个仓库' })).toBeDisabled();
  await page.getByRole('button', { name: '全选可导入仓库' }).click();
  await page.getByRole('button', { name: '导入 2 个仓库' }).click();
  await expect(page.getByRole('button', { name: '项目仓库', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '关闭添加订阅' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  releaseImport();
  await expect(page.getByRole('alert')).toContainText('暂时限流');
  await expect(
    page.getByRole('checkbox', { name: '订阅 example/repo-2', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: '导入 1 个仓库' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(imports).toBe(2);
  expect(errors).toEqual([]);
});

test('empty stars explain the state, and long repository names fit a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let populated = false;
  await page.route('**/api/github/starred/preview', (route) =>
    route.fulfill({
      json: {
        username: 'my-account',
        nextPage: null,
        repositories: populated
          ? [{ ...repo(4), name: `a-long-organization/${'long-repository-name-'.repeat(4)}` }]
          : [],
      },
    }),
  );
  await page.goto('/subscriptions');
  await page.getByRole('button', { name: '添加订阅', exact: true }).first().click();
  await page.getByRole('button', { name: '导入 Star', exact: true }).click();
  await page.getByRole('button', { name: '读取 Star 列表' }).click();
  await expect(page.getByText('这个账号还没有公开 Star 仓库。')).toBeVisible();
  populated = true;
  await page.getByRole('button', { name: '重新读取 Star' }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const dialog = page.getByRole('dialog');
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: 'work/starred-mobile.png', fullPage: true });
});
