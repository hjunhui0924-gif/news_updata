import { describe, it, expect } from 'vitest';
import { createDemoData } from '../src/server/demo/fixtures';
import { filterItems } from '../src/shared/feed';
const now = Date.parse('2026-09-13T10:00:00Z');
const { items } = createDemoData(new Date(now));
const filters = { view: 'feed', type: 'all', search: '', unread: false, source: '', now };
describe('reader filters', () => {
  it('keeps demo data explicitly labelled and excludes backfill from highlights', () => {
    expect(items).toHaveLength(24);
    expect(items.every((x) => x.demo)).toBe(true);
    expect(filterItems(items, { ...filters, view: 'today' }).every((x) => !x.backfill)).toBe(true);
  });
  it('combines saved, search and unread filters without exposing muted items', () => {
    const result = filterItems(items, {
      ...filters,
      view: 'saved',
      search: 'tailwind',
      unread: true,
    });
    expect(result.map((x) => x.id)).toEqual(['demo-item-3']);
    expect(
      filterItems(
        result.map((x) => ({ ...x, muted: true })),
        filters,
      ),
    ).toEqual([]);
  });
});
