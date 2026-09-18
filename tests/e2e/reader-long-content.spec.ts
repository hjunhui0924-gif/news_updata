import { expect, test } from '@playwright/test';
import type { Bootstrap } from '../../src/shared/types';

test('long update bodies remain readable on a phone', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/bootstrap', async (route) => {
    const data: Bootstrap = await (await route.fetch()).json();
    const body = `# Long release notes\n\n${'This paragraph remains readable on a narrow screen. '.repeat(140)}\n\n| Name | Value |\n| --- | --- |\n| mode | mobile |\n\n\`\`\`bash\nnpm run verify -- --very-long-flag\n\`\`\``;
    const item = {
      ...data.items[0],
      id: 'long-reader-item',
      externalId: 'long-reader-release',
      title: 'Long release notes',
      body,
      contentUrl: 'https://github.com/example/project/blob/HEAD/README.md',
      summary: null,
      aiStatus: 'disabled' as const,
      language: 'en' as const,
      demo: false,
    };
    await route.fulfill({ json: { ...data, items: [item], jobs: [] } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/feed');
  await page.getByRole('button', { name: '刷新内容' }).click();
  await page.getByTestId('item-long-reader-item').click();
  await expect(page.getByRole('region', { name: '更新详情' })).toBeVisible();
  await expect(page.getByText('正文较长', { exact: false })).toBeVisible();
  await page.getByRole('tab', { name: '原文', exact: true }).click();
  await expect(page.locator('.markdown').getByRole('heading', { name: 'Long release notes', exact: true })).toBeVisible();
  await expect(page.getByText('npm run verify', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'work/reader-long-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('translation explains when a long body exceeds the full-text limit', async ({ page }) => {
  await page.route('**/api/bootstrap', async (route) => {
    const data: Bootstrap = await (await route.fetch()).json();
    const item = {
      ...data.items[0],
      id: 'translation-limit-item',
      title: 'Translation limit notes',
      body: 'Long source sentence. '.repeat(900),
      summary: null,
      translation: null,
      translationBlocks: null,
      aiStatus: 'disabled' as const,
      language: 'en' as const,
      demo: false,
    };
    await route.fulfill({ json: { ...data, items: [item], jobs: [] } });
  });
  await page.goto('/feed');
  await page.getByRole('button', { name: '刷新内容' }).click();
  await page.getByTestId('item-translation-limit-item').click();
  await page.getByRole('tab', { name: '对照翻译', exact: true }).click();
  await expect(page.getByText('原文超过 16000 字符', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '生成中文翻译', exact: true })).toHaveCount(0);
});
