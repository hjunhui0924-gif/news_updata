import { expect, test, type Page } from '@playwright/test';
import type { Bootstrap, Job } from '../../src/shared/types';

function subscription(
  template: Bootstrap['subscriptions'][number],
  id: string,
  name: string,
  patch: Partial<Bootstrap['subscriptions'][number]> = {},
) {
  return {
    ...template,
    id,
    externalId: id,
    name,
    url: `https://github.com/${name}`,
    enabled: true,
    error: null,
    retryAt: null,
    coverage: 'pending' as const,
    lastSyncAt: null,
    ...patch,
  };
}

async function mockBootstrap(page: Page, online: boolean) {
  await page.route('**/api/bootstrap', async (route) => {
    const data = (await (await route.fetch()).json()) as Bootstrap;
    const template = data.subscriptions[0];
    const subscriptions = [
      subscription(template, 'sync-running', 'running/repo'),
      subscription(template, 'sync-waiting', 'waiting/repo'),
      subscription(template, 'sync-complete', 'complete/repo', {
        coverage: 'complete',
        lastSyncAt: '2026-09-18T01:00:00.000Z',
      }),
      subscription(template, 'sync-partial', 'partial/repo', { coverage: 'partial' }),
      subscription(template, 'sync-rate', 'rate/repo', {
        error: 'GitHub 暂时限制请求。',
        retryAt: '2099-09-18T02:00:00.000Z',
      }),
      subscription(template, 'sync-auth', 'auth/repo', {
        error: 'GitHub 授权已失效，请重新连接。',
      }),
    ];
    const jobs: Job[] = [
      {
        id: 'sync-running-job',
        kind: 'sync',
        targetId: 'sync-running',
        status: 'running',
        error: null,
        createdAt: '2026-09-18T01:00:00.000Z',
      },
      {
        id: 'sync-waiting-job',
        kind: 'sync',
        targetId: 'sync-waiting',
        status: 'pending',
        error: null,
        createdAt: '2026-09-18T01:00:00.000Z',
      },
    ];
    await route.fulfill({
      json: {
        ...data,
        subscriptions,
        jobs,
        services: { ...data.services, workerOnline: online, workerLastSeen: online ? new Date().toISOString() : null },
      },
    });
  });
}

test('subscription cards explain queue, completion, partial, rate-limit, and auth states', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockBootstrap(page, true);
  await page.goto('/subscriptions');
  await page.getByRole('button', { name: '刷新内容' }).click();
  await expect(page.getByText('正在同步', { exact: true })).toBeVisible();
  await expect(page.getByText('等待同步', { exact: true })).toBeVisible();
  await expect(page.getByText('已完成', { exact: true })).toBeVisible();
  await expect(page.getByText('部分完成', { exact: true })).toBeVisible();
  await expect(page.getByText('等待限流结束', { exact: true })).toBeVisible();
  await expect(page.getByText('需要重新连接', { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('article')
      .filter({ has: page.getByRole('link', { name: 'partial/repo', exact: true }) })
      .getByRole('button', { name: '重试同步 partial/repo', exact: true }),
  ).toBeEnabled();
  await expect(
    page
      .getByRole('article')
      .filter({ has: page.getByRole('link', { name: 'rate/repo', exact: true }) })
      .getByRole('button', { name: '同步 rate/repo', exact: true }),
  ).toBeDisabled();
  await page.screenshot({ path: 'work/sync-status-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('subscription management announces an offline worker while keeping content available', async ({ page }) => {
  await mockBootstrap(page, false);
  await page.goto('/subscriptions');
  await page.getByRole('button', { name: '刷新内容' }).click();
  await expect(page.getByRole('status')).toContainText('后台同步服务未连接');
  await expect(page.getByText('已有内容仍可阅读')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'work/sync-status-mobile.png', fullPage: true });
});
