import { expect, test } from '@playwright/test';
test('searches public projects, paginates, retries and subscribes locally on mobile', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let fail = false;
  let subscribed = false;
  await page.route('**/api/github/repositories/search', async (route) => {
    const body = route.request().postDataJSON();
    if (fail)
      return route.fulfill({ status: 429, json: { error: 'GitHub 搜索暂时限流，请稍后重试。' } });
    await route.fulfill({
      json: {
        query: body.query,
        page: body.page,
        totalCount: 21,
        incomplete: false,
        nextPage: body.page === 1 ? 2 : null,
        repositories:
          body.query === 'nothing'
            ? []
            : [
                {
                  id: 'repo-result',
                  name: body.page === 1 ? 'someone/ai-agent' : 'someone/second-project',
                  description: 'An assistant for project research.',
                  url: 'https://github.com/someone/ai-agent',
                  stars: 1234,
                  language: 'Python',
                  updatedAt: new Date().toISOString(),
                  archived: false,
                  subscribed,
                },
              ],
      },
    });
  });
  await page.route('**/api/subscriptions', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ kind: 'repo', input: 'someone/ai-agent' });
    subscribed = true;
    await route.fulfill({ json: { id: 'local-subscription' } });
  });
  await page.goto('/subscriptions');
  await page.getByRole('button', { name: '添加订阅', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '搜索项目', exact: true }).click();
  await dialog.getByLabel('搜索 GitHub 公开项目').fill('AI agent');
  await dialog.getByLabel('项目搜索排序').selectOption('stars');
  await dialog.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(dialog.getByRole('link', { name: 'someone/ai-agent' })).toBeVisible();
  await expect(dialog.getByText('不会改变 GitHub Star', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: '下一页' }).click();
  await expect(dialog.getByRole('link', { name: 'someone/second-project' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '下一页' })).toBeDisabled();
  await dialog.getByRole('button', { name: '上一页' }).click();
  await dialog.getByRole('button', { name: '在知更中订阅' }).click();
  await expect(dialog.getByRole('button', { name: '已在知更订阅' })).toBeDisabled();
  fail = true;
  await dialog.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('限流');
  fail = false;
  await dialog.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'work/repository-search-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByLabel('搜索 GitHub 公开项目').fill('nothing');
  await dialog.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(dialog.getByText('当前没有可展示的公开项目，试试其他关键词。')).toBeVisible();
  expect(errors).toEqual([]);
});
