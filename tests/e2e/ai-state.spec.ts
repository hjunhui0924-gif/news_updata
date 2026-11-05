import { expect, test } from '@playwright/test';
import { mockReaderBootstrap } from './reader-fixtures';

test('AI disabled, enabled on historical items, quota failures and cached artifacts remain distinguishable', async ({
  page,
}) => {
  let enabled = false;
  let cached = false;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockReaderBootstrap(page, (data) => {
    return {
      ...data,
      jobs: [],
      services: { ...data.services, ai: enabled },
      items: data.items.map((item) => ({
        ...item,
        demo: false,
        aiStatus: cached ? 'ready' : 'disabled',
        summary: cached ? item.summary : null,
        translation: cached ? '已经保存的中文译文' : null,
      })),
    };
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
  await detail.getByRole('tab', { name: '对照翻译' }).click();
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
  await detail.getByRole('tab', { name: '对照翻译' }).click();
  await expect(detail.getByText('已经保存的中文译文')).toBeVisible();
  await expect(detail.getByText('此历史译文按全文对照显示。', { exact: false })).toBeVisible();
  await page.screenshot({ path: 'work/ai-state.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('summary and translation job failures show separate errors and can be retried', async ({
  page,
}) => {
  let summaryFailed = true;
  let translationFailed = true;
  await mockReaderBootstrap(page, (data) => {
    return {
      ...data,
      services: { ...data.services, ai: true },
      jobs: [
        ...(summaryFailed
          ? [
              {
                id: 'summary-job',
                kind: 'summary' as const,
                targetId: 'demo-item-0',
                status: 'failed' as const,
                error: '摘要服务暂时不可用',
                createdAt: new Date().toISOString(),
              },
            ]
          : []),
        ...(translationFailed
          ? [
              {
                id: 'translation-job',
                kind: 'translation' as const,
                targetId: 'demo-item-0',
                status: 'failed' as const,
                error: '翻译服务暂时不可用',
                createdAt: new Date().toISOString(),
              },
            ]
          : []),
      ],
      items: data.items.map((item) => ({
        ...item,
        demo: false,
        summary: null,
        translation: null,
      })),
    };
  });
  await page.route('**/api/items/demo-item-0/summary/retry', async (route) => {
    summaryFailed = false;
    await route.fulfill({ status: 202, json: { accepted: true } });
  });
  await page.route('**/api/items/demo-item-0/translation', async (route) => {
    translationFailed = false;
    await route.fulfill({ status: 202, json: { accepted: true } });
  });
  await page.goto('/feed');
  await page.getByRole('button', { name: '刷新内容' }).click();
  await page.getByTestId('item-demo-item-0').click();
  const detail = page.getByRole('region', { name: '更新详情' });
  await expect(detail.getByRole('alert')).toHaveText('摘要服务暂时不可用');
  await detail.getByRole('button', { name: '重试摘要' }).click();
  await expect(detail.getByRole('button', { name: '生成摘要' })).toBeVisible();
  await detail.getByRole('tab', { name: '对照翻译' }).click();
  await expect(detail.getByRole('alert')).toHaveText('翻译服务暂时不可用');
  await detail.getByRole('button', { name: '重试翻译' }).click();
  await expect(detail.getByRole('button', { name: '生成中文翻译' })).toBeVisible();
});

test('summary and translation pending states stay attached to their own tabs', async ({ page }) => {
  await mockReaderBootstrap(page, (data) => {
    return {
      ...data,
      services: { ...data.services, ai: true },
      jobs: (['summary', 'translation'] as const).map((kind) => ({
        id: `${kind}-job`,
        kind,
        targetId: 'demo-item-0',
        status: 'pending',
        error: null,
        createdAt: new Date().toISOString(),
      })),
      items: data.items.map((item) => ({
        ...item,
        demo: false,
        summary: null,
        translation: null,
      })),
    };
  });
  await page.goto('/feed');
  await page.getByRole('button', { name: '刷新内容' }).click();
  await page.getByTestId('item-demo-item-0').click();
  const detail = page.getByRole('region', { name: '更新详情' });
  await expect(detail.getByRole('heading', { name: '该条目的 AI 任务正在处理…' })).toBeVisible();
  await expect(detail.getByRole('button', { name: '生成摘要' })).toBeDisabled();
  await detail.getByRole('tab', { name: '对照翻译' }).click();
  await expect(detail.getByRole('heading', { name: '翻译任务正在处理…' })).toBeVisible();
  await expect(detail.getByRole('button', { name: '生成中文翻译' })).toBeDisabled();
});

test('pending, timeout, invalid output and exhausted budget never block original reading or saving', async ({
  page,
}) => {
  let stage = 'pending';
  await mockReaderBootstrap(page, (data) => ({
    ...data,
    services: { ...data.services, ai: true },
    jobs: [
      {
        id: 'degraded-summary',
        kind: 'summary',
        targetId: 'demo-item-0',
        status: stage === 'pending' ? 'running' : 'failed',
        error: stage === 'pending' ? null : `fixture ${stage}`,
        createdAt: new Date().toISOString(),
      },
    ],
    items: data.items.map((item) => ({ ...item, demo: false, summary: null, translation: null })),
  }));
  let paidRequests = 0;
  await page.route('**/api/items/*/summary/retry', (route) => {
    paidRequests++;
    return route.fulfill({ status: 500, json: { error: 'unexpected paid retry' } });
  });
  await page.goto('/feed');
  for (stage of ['pending', 'timeout', 'invalid-output', 'budget-exhausted']) {
    await page.getByRole('button', { name: '刷新内容' }).click();
    await page.getByTestId('item-demo-item-0').click();
    const detail = page.getByRole('region', { name: '更新详情' });
    await detail.getByRole('tab', { name: '原文', exact: true }).click();
    await expect(detail.getByText('DEMO FIXTURE', { exact: false })).toBeVisible();
    await detail.getByRole('button', { name: '收藏更新', exact: true }).click();
    await expect(detail.getByRole('button', { name: '取消收藏', exact: true })).toBeEnabled();
    await detail.getByRole('button', { name: '取消收藏', exact: true }).click();
    await expect(detail.getByRole('button', { name: '收藏更新', exact: true })).toBeEnabled();
    await detail.getByRole('button', { name: '返回列表', exact: true }).click();
  }
  expect(paidRequests).toBe(0);
  await page.unrouteAll({ behavior: 'wait' });
});

test('bilingual paragraphs keep original above Chinese on desktop and mobile', async ({ page }) => {
  await mockReaderBootstrap(page, (data) => {
    return {
      ...data,
      items: data.items.map((item) => ({
        ...item,
        language: 'en',
        translation: '加载更快。',
        translationBlocks: [
          { original: '### Improvements', translation: '### 改进' },
          { original: 'Faster loading.', translation: '加载更快。' },
          {
            original:
              '- Default image requests to GPT Image 2.5 Flare. [#101](https://github.com/example/repo/issues/101)\n- Refresh image backend guidance across all languages.',
            translation:
              '- 默认图片请求使用 GPT Image 2.5 Flare。[#101](https://github.com/example/repo/issues/101)\n- 更新所有语言的图片后端指引。',
          },
          { original: '```js\nconsole.log(1);\n```', translation: null },
        ],
      })),
    };
  });
  await page.goto('/feed');
  await page.getByRole('button', { name: '刷新内容' }).click();
  await page.getByTestId('item-demo-item-0').click();
  await page.getByRole('tab', { name: '对照翻译' }).click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const block = page.getByRole('region', { name: '对照段落 2', exact: true });
    const original = await block.getByText('Faster loading.').boundingBox();
    const translated = await block.getByText('加载更快。').boundingBox();
    expect(original).not.toBeNull();
    expect(translated).not.toBeNull();
    expect(translated!.y).toBeGreaterThan(original!.y + original!.height);
    expect(await page.getByText('console.log(1);').count()).toBe(1);
    const list = page.getByRole('region', { name: '对照段落 3', exact: true });
    const entries = list.getByRole('listitem');
    await expect(entries).toHaveCount(2);
    const firstEnglish = await entries.first().locator('p').first().boundingBox();
    const firstChinese = await entries.first().locator('p[lang="zh-CN"]').boundingBox();
    const nextEnglish = await entries.nth(1).locator('p').first().boundingBox();
    expect(firstChinese!.y).toBeGreaterThan(firstEnglish!.y + firstEnglish!.height);
    expect(nextEnglish!.y).toBeGreaterThan(firstChinese!.y + firstChinese!.height);
    expect(firstChinese!.x).toBe(firstEnglish!.x);
    await expect(entries.first().getByRole('link', { name: '#101' })).toHaveCount(2);
    expect(await list.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('0px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `work/bilingual-${width}.png`, fullPage: true });
  }
});
