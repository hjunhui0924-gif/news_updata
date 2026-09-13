import { test, expect } from '@playwright/test';

const repo = (id: number, subscribed = false) => ({
  id: String(id),
  name: `example/repo-${id}`,
  description: 'A repository for testing starred import',
  url: `https://github.com/example/repo-${id}`,
  subscribed,
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
