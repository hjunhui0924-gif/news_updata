import { expect, test } from '@playwright/test';
import type { Bootstrap, GitHubAuthStatus } from '../../src/shared/types';
test('connection states recover, show inline errors and reconnect through GitHub on mobile', async ({
  page,
}) => {
  let state: GitHubAuthStatus = {
    state: 'refresh_pending',
    message: '访问凭据已到期，下次同步会自动续期。',
    expiresAt: new Date().toISOString(),
    retryAt: null,
  };
  let checkFails = false;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/bootstrap', async (route) => {
    const data: Bootstrap = await (await route.fetch()).json();
    data.mode = 'live';
    data.services.githubAuth = state;
    await route.fulfill({ json: data });
  });
  await page.route('**/api/github/connection', async (route) => {
    expect(route.request().method()).toBe('POST');
    if (checkFails)
      return route.fulfill({ status: 503, json: { error: '暂时无法连接 GitHub，请稍后重试。' } });
    state = { ...state, state: 'connected', message: 'GitHub 已连接，访问凭据将按需自动续期。' };
    await route.fulfill({ json: state });
  });
  await page.goto('/settings');
  await page.getByRole('button', { name: '刷新内容' }).click();
  await expect(page.getByRole('button', { name: '检查连接' })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新连接 GitHub' })).toHaveCount(0);
  await page.getByRole('button', { name: '检查连接' }).click();
  await expect(page.getByRole('status', { name: 'GitHub 授权状态' })).toContainText(
    'GitHub 已连接',
  );
  state = {
    ...state,
    state: 'temporary_error',
    message: 'GitHub 连接暂时失败，稍后会自动重试，无需重新登录。',
  };
  await page.getByRole('button', { name: '刷新内容' }).click();
  await expect(page.getByRole('status', { name: 'GitHub 授权状态' })).toContainText('无需重新登录');
  checkFails = true;
  await page.getByRole('button', { name: '检查连接' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '暂时无法连接' })).toContainText(
    '暂时无法连接',
  );
  state = {
    ...state,
    state: 'reconnect_required',
    message: 'GitHub 授权已失效，请重新连接。订阅和阅读记录仍保留。',
  };
  await page.getByRole('button', { name: '刷新内容' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '重新连接 GitHub' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'work/github-auth-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.route('**/api/auth/sign-in/social', async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      provider: 'github',
      callbackURL: '/settings',
    });
    await route.fulfill({
      json: { url: 'https://github.com/login/oauth/authorize?client_id=test' },
    });
  });
  await page.route('https://github.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: 'GitHub authorization test' }),
  );
  await page.getByRole('button', { name: '重新连接 GitHub' }).click();
  await expect(page).toHaveURL(/https:\/\/github.com\/login\/oauth\/authorize/);
  expect(errors).toEqual([]);
});
