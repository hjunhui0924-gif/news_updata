import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { mockReaderBootstrap } from './reader-fixtures';
import { summarize } from '../../scripts/benchmarks/statistics';

test('long original stays readable and twenty keyboard roundtrips keep context and bounded memory', async ({
  page,
  browserName,
}) => {
  test.setTimeout(120000);
  test.skip(browserName !== 'chromium', 'Memory diagnostics use Chromium CDP.');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.name));
  await mockReaderBootstrap(page, (data) => ({
    ...data,
    jobs: [],
    items: Array.from({ length: 65 }, (_, index) => ({
      ...data.items[0],
      id: `continuity-${index}`,
      title: `Continuity fixture ${index}`,
      read: true,
      summary: null,
      body: `# Complete original\n\n${'A paragraph with [source](https://example.com) and **important detail**.\n\n'.repeat(400)}\n\nFinal original evidence.`,
    })),
  }));
  await page.goto('/feed');
  await page.getByRole('button', { name: '刷新内容' }).click();
  for (let loaded = 30; loaded < 65; loaded += 30)
    await page
      .locator('.feed-panel .list-end')
      .getByRole('button', { name: '加载更多更新' })
      .click();
  await expect(page.locator('.update-card')).toHaveCount(65);
  const panel = page.getByRole('region', { name: '更新列表' });
  const card = page.getByTestId('item-continuity-40');
  await page.evaluate(() => {
    const state = window as typeof window & { readingFeedback: number[] };
    state.readingFeedback = [];
    let pending: { card: Element; at: number } | undefined;
    document.addEventListener(
      'click',
      (event) => {
        const card = event.target instanceof Element ? event.target.closest('.update-card') : null;
        if (card) pending = { card, at: performance.now() };
      },
      true,
    );
    new MutationObserver(() => {
      if (pending?.card.getAttribute('aria-pressed') === 'true') {
        state.readingFeedback.push(performance.now() - pending.at);
        pending = undefined;
      }
    }).observe(document.querySelector('.update-list')!, {
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-pressed'],
    });
  });
  const heap: number[] = [];
  const nodes: number[] = [];
  const cdp = browserName === 'chromium' ? await page.context().newCDPSession(page) : null;
  for (let round = 0; round < 23; round++) {
    await card.focus();
    const before = await panel.evaluate((element) => element.scrollTop);
    await card.press('Enter');
    await expect(page.getByRole('region', { name: '更新详情' })).toBeVisible();
    await page.getByRole('tab', { name: '原文', exact: true }).click();
    await expect(page.locator('.markdown')).toContainText('Final original evidence.');
    await page.goBack();
    await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBe(before);
    await expect(card).toBeFocused();
    await expect(card).toHaveClass(/read/);
    if (round >= 2 && round % 4 === 2 && cdp) {
      await cdp.send('HeapProfiler.collectGarbage');
      heap.push((await cdp.send('Runtime.getHeapUsage')).usedSize);
      nodes.push((await cdp.send('Memory.getDOMCounters')).nodes);
    }
  }
  // Three warm-ups + twenty measured returns; normalized GC separates retained state from garbage.
  expect(heap.length).toBeGreaterThanOrEqual(5);
  expect(heap.at(-1)!).toBeLessThan(heap[0] * 1.25 + 2 * 1024 * 1024);
  expect(nodes.at(-1)!).toBeLessThan(nodes[0] + 1000);
  expect(errors).toEqual([]);
  const feedback = await page.evaluate(
    () => (window as typeof window & { readingFeedback: number[] }).readingFeedback,
  );
  expect(feedback).toHaveLength(23);
  expect(summarize(feedback.slice(3)).p95Ms).toBeLessThanOrEqual(200);
  await mkdir('work/aggregation-baseline', { recursive: true });
  await writeFile(
    'work/aggregation-baseline/reading-memory.json',
    JSON.stringify(
      {
        roundtrips: 20,
        warmups: 3,
        retainedHeapBytes: heap,
        domNodes: nodes,
        localSelectionFeedback: summarize(feedback.slice(3)),
        scope:
          'development Chromium, fixed mocked long original; explicit GC; not a user-device memory SLA',
      },
      null,
      2,
    ),
  );
  await page.unrouteAll({ behavior: 'wait' });
});

test('a pending read mutation keeps keyboard focus when a card crosses a layout batch', async ({
  page,
}) => {
  await mockReaderBootstrap(page, (data) => ({
    ...data,
    jobs: [],
    items: Array.from({ length: 65 }, (_, index) => ({
      ...data.items[0],
      id: `focus-${index}`,
      title: `Focus fixture ${index}`,
      read: false,
    })),
  }));
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sending = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route('**/api/items/focus-0/state', async (route) => {
    started();
    await gate;
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto('/feed');
  await page.getByRole('button', { name: '刷新内容' }).click();
  const panel = page.getByRole('region', { name: '更新列表' });
  await panel.getByRole('button', { name: '未读', exact: true }).click();
  await panel.getByRole('button', { name: '加载更多更新' }).click();
  await page.getByTestId('item-focus-0').focus();
  await page.getByTestId('item-focus-0').press('Enter');
  await sending;
  try {
    await page.getByTestId('item-focus-30').focus();
  } finally {
    release();
  }
  await expect(page.getByTestId('item-focus-0')).toHaveCount(0);
  await expect(page.getByTestId('item-focus-30')).toBeFocused();
  await page.locator('.app-shell').evaluate((element) => element.classList.add('compact'));
  await expect(page.locator('.update-batch').nth(1)).toHaveCSS('margin-top', '6px');
  await expect(page.locator('.update-card').nth(1)).toHaveCSS('margin-top', '6px');
  await page.screenshot({ path: 'work/aggregation-baseline/compact.png' });
  await page.unrouteAll({ behavior: 'wait' });
});

test('mobile return button restores keyboard focus to the entry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 960 });
  await mockReaderBootstrap(page, (data) => ({
    ...data,
    jobs: [],
    items: [{ ...data.items[0], id: 'mobile-return', read: true }],
  }));
  await page.goto('/feed');
  await page.getByRole('button', { name: '刷新内容' }).click();
  const card = page.getByTestId('item-mobile-return');
  await card.focus();
  await card.press('Enter');
  await expect(page.getByRole('region', { name: '更新详情' })).toBeVisible();
  await page.getByRole('button', { name: '返回列表', exact: true }).click();
  await expect(card).toBeFocused();
  await page.unrouteAll({ behavior: 'wait' });
});
