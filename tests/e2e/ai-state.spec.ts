import { expect, test } from '@playwright/test';
import type { FeedItem } from '../../src/shared/types';

test('AI disabled, enabled on historical items, quota failures and cached artifacts remain distinguishable', async ({
  page,
}) => {
  let enabled = false;
  let cached = false;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/bootstrap', async (route) => {
    const data = await (await route.fetch()).json();
    await route.fulfill({
      json: {
        ...data,
        jobs: [],
        services: { ...data.services, ai: enabled },
        items: data.items.map((item: FeedItem) => ({
          ...item,
          demo: false,
          aiStatus: cached ? 'ready' : 'disabled',
          summary: cached ? item.summary : null,
          translation: cached ? '已经保存的中文译文' : null,
        })),
      },
    });
  });
  await page.route('**/api/items/*/summary/retry', (route) =>
    route.fulfill({
      status: 400,
      json: { error: '模型免费额度已耗尽，当前账号仅允许使用免费额度。' },
    }),
  );
  await page.goto('/feed');
  await page.getByRole('button', { name: '刷新内容' }).click();
  await page.getByTestId('item-demo-item-0').click();
  const detail = page.getByRole('region', { name: '更新详情' });
  await expect(detail.getByRole('heading', { name: 'AI 摘要尚未启用' })).toBeVisible();
  await expect(detail.getByRole('button', { name: '生成摘要' })).toBeDisabled();
  await detail.getByRole('tab', { name: '中文译文' }).click();
  await expect(detail.getByText('AI 服务当前关闭，暂时无法翻译。', { exact: false })).toBeVisible();
  await expect(detail.getByRole('button', { name: '生成中文翻译' })).toBeDisabled();
  await detail.getByRole('tab', { name: '原文', exact: true }).click();
  await expect(detail.getByText('DEMO FIXTURE', { exact: false })).toBeVisible();
  enabled = true;
  await page.getByRole('button', { name: '刷新内容' }).click();
  await detail.getByRole('tab', { name: '中文摘要' }).click();
  await expect(detail.getByRole('button', { name: '生成摘要' })).toBeEnabled();
  await detail.getByRole('button', { name: '生成摘要' }).click();
  await expect(page.getByRole('status').filter({ hasText: '模型免费额度已耗尽' })).toBeVisible();
  cached = true;
  enabled = false;
  await page.getByRole('button', { name: '刷新内容' }).click();
  await expect(detail.getByRole('heading', { name: '这次更新了什么' })).toBeVisible();
  await detail.getByRole('tab', { name: '中文译文' }).click();
  await expect(detail.getByText('已经保存的中文译文')).toBeVisible();
  await page.screenshot({ path: 'work/ai-state.png', fullPage: true });
  expect(errors).toEqual([]);
});
