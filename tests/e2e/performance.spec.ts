import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { mockReaderBootstrap } from './reader-fixtures';
import { summarize } from '../../scripts/benchmarks/statistics';

for (const width of [1440, 768, 390]) {
  for (const count of [30, 600, 2000]) {
    test(`mixed feed baseline: ${count} rows at ${width}px`, async ({ page, browser }, info) => {
      test.setTimeout(180000);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.name));
      await page.setViewportSize({ width, height: 1000 });
      await page.route('https://i.ytimg.com/**', (route) => route.abort());
      await mockReaderBootstrap(page, (data) => ({
        ...data,
        jobs: [],
        items: Array.from({ length: count }, (_, index) => ({
          ...data.items[index % data.items.length],
          id: `performance-${index}`,
          title: `Mixed fixture ${index} ${index % 7 === 0 ? 'Long title '.repeat(20) : ''}`,
          platform: index % 3 === 0 ? 'youtube' : 'github',
          type: index % 3 === 0 ? 'video' : index % 3 === 1 ? 'release' : 'new_repo',
          media:
            index % 3 === 0
              ? {
                  kind: 'video',
                  content: 'description',
                  thumbnailUrl: 'https://i.ytimg.com/vi/fixture/default.jpg',
                }
              : undefined,
          read: true,
        })),
      }));
      await page.goto('/feed');
      await page.getByRole('button', { name: '刷新内容' }).click();
      await expect(page.getByTestId('item-performance-0')).toBeVisible();
      for (let loaded = 30; loaded < count; loaded += 30) {
        await page
          .locator('.feed-panel .list-end')
          .getByRole('button', { name: '加载更多更新' })
          .click();
        await expect(page.locator('.update-card')).toHaveCount(Math.min(count, loaded + 30));
      }
      const rounds = [];
      for (let round = 0; round < 3; round++) {
        const samples = await page
          .getByRole('region', { name: '更新列表' })
          .evaluate(async (element) => {
            const frames: number[] = [];
            let previous = performance.now();
            for (let index = 0; index < 94; index++) {
              element.scrollTop =
                (element.scrollHeight - element.clientHeight) * ((index % 47) / 46);
              await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
              const now = performance.now();
              if (index >= 4) frames.push(now - previous);
              previous = now;
            }
            return frames;
          });
        rounds.push({ ...summarize(samples), samplesMs: samples });
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(errors).toEqual([]);
      const report = {
        recordedAt: new Date().toISOString(),
        rows: count,
        width,
        browser: browser.version(),
        mode: 'development; mocked HTTP metadata; default CPU/network; image failures injected',
        rounds,
      };
      await mkdir('work/aggregation-baseline', { recursive: true });
      const path = `work/aggregation-baseline/feed-${count}-${width}.json`;
      await writeFile(path, JSON.stringify(report, null, 2));
      await info.attach('baseline', { path, contentType: 'application/json' });
      if (count === 600 && width === 1440)
        await page.screenshot({ path: 'work/aggregation-baseline/desktop.png' });
      if (count === 600 && width === 390)
        await page.screenshot({ path: 'work/aggregation-baseline/mobile.png' });
      await page.unrouteAll({ behavior: 'wait' });
    });
  }
}
