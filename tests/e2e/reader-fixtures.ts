import type { Page } from '@playwright/test';
import type { Bootstrap, FeedItem } from '../../src/shared/types';
import { createDemoData } from '../../src/server/demo/fixtures';
import { filterItems, toFeedPreview } from '../../src/shared/feed';

type FullBootstrap = Omit<Bootstrap, 'items'> & { items: FeedItem[] };
// Browser mocks keep the real split contract: list previews, metadata and full item details.
export async function mockReaderBootstrap(
  page: Page,
  transform: (data: FullBootstrap) => FullBootstrap,
) {
  let items = createDemoData().items;
  const states = new Map<string, Partial<Pick<FeedItem, 'read' | 'saved' | 'muted'>>>();
  const current = () => items.map((item) => ({ ...item, ...states.get(item.id) }));
  await page.route('**/api/bootstrap*', async (route) => {
    const real = await (await route.fetch()).json();
    const next = transform({ ...real, items: createDemoData().items });
    items = next.items;
    const rows = current();
    const { items: ignored, ...metadata } = next;
    void ignored;
    await route.fulfill({
      json: {
        ...metadata,
        items: new URL(route.request().url()).searchParams.has('metadata')
          ? []
          : rows.slice(0, 30).map(toFeedPreview),
        feed: {
          total: rows.length,
          all: rows.length,
          unread: rows.filter((x) => !x.read).length,
          saved: rows.filter((x) => x.saved).length,
          nextCursor: null,
        },
      },
    });
  });
  await page.route('**/api/feed?**', async (route) => {
    const q = new URL(route.request().url()).searchParams;
    const rows = current();
    const filtered = filterItems(rows, {
      view: q.get('view') || 'feed',
      type: q.get('type') || 'all',
      search: q.get('search') || '',
      unread: q.get('unread') === 'true',
      source: q.get('source') || '',
    });
    const offset = Number(q.get('cursor') || 0);
    const status = {
      total: filtered.length,
      all: rows.length,
      unread: rows.filter((x) => !x.read).length,
      saved: rows.filter((x) => x.saved).length,
      matchingUnread: filtered.filter((x) => !x.read).length,
    };
    await route.fulfill({
      json: q.has('status')
        ? { ...status, headId: filtered[0]?.id ?? null }
        : {
            ...status,
            items: filtered.slice(offset, offset + 30).map(toFeedPreview),
            nextCursor: offset + 30 < filtered.length ? String(offset + 30) : null,
          },
    });
  });
  await page.route(/\/api\/items\/[^/?]+$/, async (route) => {
    const item = current().find((item) => route.request().url().endsWith(`/${item.id}`));
    await route.fulfill({ status: item ? 200 : 404, json: item ?? { error: '更新不存在' } });
  });
  await page.route('**/api/items/*/state', async (route) => {
    const id = route.request().url().split('/').at(-2)!;
    states.set(id, { ...states.get(id), ...route.request().postDataJSON() });
    await route.fulfill({ json: { ok: true } });
  });
}
