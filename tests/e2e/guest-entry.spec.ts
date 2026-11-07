import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`anonymous visitor can preview an empty workspace without user content at ${width}px`, async ({
    page,
  }) => {
    const apiRequests: string[] = [];
    const pageErrors: string[] = [];
    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith('/api/')) apiRequests.push(pathname);
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/login');
    await expect(page.getByRole('link', { name: '先浏览空工作区' })).toBeVisible();
    await page.getByRole('link', { name: '先浏览空工作区' }).click();
    await expect(page).toHaveURL(/\/guest$/);
    await expect(page.getByRole('heading', { name: '把关注，读成有用的更新。' })).toBeVisible();
    await expect(page.getByText('0 个启用来源', { exact: true })).toBeVisible();
    await expect(page.getByText('0 条未读', { exact: true })).toBeVisible();
    await expect(page.getByText('原文阅读可用 · AI 可选')).toBeVisible();
    if (width < 700) {
      await page.getByRole('button', { name: '信息流' }).last().click();
    } else {
      await page.getByRole('button', { name: '全部更新' }).click();
    }
    await expect(page.getByRole('heading', { name: '全部更新', exact: true })).toBeVisible();
    await expect(page.getByText('还没有更新')).toBeVisible();
    if (width < 700) {
      await page.getByRole('button', { name: '订阅' }).last().click();
    } else {
      await page.getByRole('button', { name: '订阅管理' }).click();
    }
    await expect(page.getByRole('heading', { name: '关注你真正关心的', exact: true })).toBeVisible();
    if (width < 700) await page.getByRole('button', { name: '打开导航' }).click();
    await page.getByRole('button', { name: '账号菜单' }).click();
    await page.getByRole('menuitem', { name: '个人 AI 服务' }).click();
    await expect(page.getByRole('heading', { name: '登录后设置个人 AI' })).toBeVisible();
    await expect(page.getByRole('link', { name: '使用 GitHub 登录' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('link', { name: '使用 GitHub 登录' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('link', { name: '先浏览空工作区' })).toBeVisible();
    expect(apiRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}
