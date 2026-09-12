import { it, expect } from 'vitest';
import { digestItems } from '../src/server/notifications/digest';
import { createDemoData } from '../src/server/demo/fixtures';
it('web brief excludes read, muted and backfill updates and prioritizes watched projects', () => {
  const { items } = createDemoData();
  const candidates = items.map((item, index) => ({
    ...item,
    read: index === 0,
    muted: index === 1,
    backfill: index === 2,
    priority: index === 3,
  }));
  const result = digestItems(candidates);
  expect(result).toHaveLength(10);
  expect(result[0].id).toBe('demo-item-3');
  expect(result.some((x) => ['demo-item-0', 'demo-item-1', 'demo-item-2'].includes(x.id))).toBe(
    false,
  );
  expect(digestItems(candidates.map((x) => ({ ...x, read: true })))).toEqual([]);
});
