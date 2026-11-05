import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { migrate } from '../../scripts/migrate';
import { getPool } from '../../src/server/db/client';
import {
  getFeedPage,
  getFeedStatus,
  getItem,
  markFeedRead,
  saveItem,
} from '../../src/server/db/store';
import { bootstrap } from '../../src/server/feed/bootstrap';
import { createDemoData } from '../../src/server/demo/fixtures';
import { patchFeedPage } from '../../src/components/use-feed';
const userId = `feed-${randomUUID()}`;
const filters = { view: 'feed', type: 'all', search: '', unread: false, source: '' };
beforeAll(async () => {
  process.env.APP_MODE = 'demo';
  await migrate();
  await getPool().query('INSERT INTO app_users(id,name) VALUES($1,$2)', [userId, 'feed test']);
  const template = createDemoData().items[0];
  for (let i = 0; i < 65; i++)
    await saveItem(userId, {
      ...template,
      platform: i % 2 === 1 ? 'youtube' : 'github',
      id: `${userId}-${String(i).padStart(3, '0')}`,
      externalId: `${i}`,
      publishedAt: '2026-11-04T00:00:00.000Z',
      saved: i % 2 === 0,
      read: false,
      sourceId: 'project',
      sourceIds: ['project', 'author'],
    });
});
afterAll(async () => {
  await getPool().query('DELETE FROM items WHERE user_id=$1', [userId]);
  await getPool().query('DELETE FROM app_users WHERE id=$1', [userId]);
  await getPool().end();
});
it('uses stable id tie breakers through all pages with no duplicates or omissions', async () => {
  let cursor: string | null = null;
  const ids: string[] = [];
  do {
    const page = await getFeedPage(userId, { ...filters, cursor });
    expect(page.total).toBe(65);
    expect(page.all).toBe(65);
    ids.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
  } while (cursor);
  expect(ids).toHaveLength(65);
  expect(new Set(ids).size).toBe(65);
  expect(ids).toEqual([...ids].sort().reverse());
});
it('projects previews in SQL and serializes bootstrap items only once', async () => {
  const page = await getFeedPage(userId, filters);
  for (const key of ['body', 'translation', 'translationBlocks', 'contentHash', 'aiError'])
    expect(page.items[0]).not.toHaveProperty(key);
  expect(await getItem(userId, page.items[0].id)).toHaveProperty('body');
  expect(await getItem('another-user', page.items[0].id)).toBeNull();
  const data = JSON.parse(JSON.stringify(await bootstrap({ id: userId, name: 'test' })));
  expect(data.feed).not.toHaveProperty('items');
  expect(data.items).toHaveLength(30);
});
it('searches materialized tags literally and updates generated text with content', async () => {
  const id = `${userId}-064`;
  const original = (await getItem(userId, id))!;
  await saveItem(userId, {
    ...original,
    tags: ['100%', 'under_score', 'two', 'tags'],
    description: 'x'.repeat(400) + 'long-suffix',
  });
  for (const search of ['100%', 'under_score', 'two tags', 'long-suffix']) {
    const page = await getFeedPage(userId, { ...filters, search });
    expect(page.total).toBe(1);
    expect(page.items[0].id).toBe(id);
  }
  await saveItem(userId, original);
});
it('rejects malformed cursor as a validation error', async () => {
  await expect(getFeedPage(userId, { ...filters, cursor: 'garbage' })).rejects.toMatchObject({
    name: 'ZodError',
  });
});
it('polling returns filtered counters and a head id with no article content', async () => {
  const status = await getFeedStatus(userId, { ...filters, view: 'saved', source: 'author' });
  expect(status).toMatchObject({ total: 33, matchingUnread: 33, unread: 65, saved: 33, all: 65 });
  expect(status.headId).toBe(`${userId}-064`);
  expect(status).not.toHaveProperty('items');
  const metadata = await bootstrap({ id: userId, name: 'test' }, true);
  expect(metadata.items).toEqual([]);
  expect(metadata.feed).toBeUndefined();
});
it('marks the entire matching saved/source/search result read without changing other rows', async () => {
  const query = { ...filters, view: 'saved', source: 'author', search: 'shadcn', unread: true };
  const first = await getFeedPage(userId, query);
  expect(first.total).toBe(33);
  expect(first.items).toHaveLength(30);
  expect(await markFeedRead(userId, query)).toBe(33);
  expect((await getFeedPage(userId, query)).total).toBe(0);
  expect((await getFeedPage(userId, filters)).unread).toBe(32);
  expect(await markFeedRead('another-user', filters)).toBe(0);
});
it('updates counters and filtered membership immediately on a successful mutation', () => {
  const item = { ...createDemoData().items[0], saved: true, read: false };
  const page = { items: [item], total: 1, all: 2, saved: 1, unread: 2, nextCursor: 'older' };
  const result = patchFeedPage(page, { ...filters, view: 'saved' }, item, { saved: false });
  expect(result).toMatchObject({ items: [], total: 0, saved: 0, unread: 2, nextCursor: 'older' });
  expect(patchFeedPage(page, { ...filters, unread: true }, item, { read: true })).toMatchObject({
    items: [],
    total: 0,
    unread: 1,
  });
});
it('uses each cached row state when a PATCH response arrives after an authoritative refresh', () => {
  const item = { ...createDemoData().items[0], read: false };
  const oldCache = {
    items: [item],
    total: 65,
    matchingUnread: 65,
    unread: 65,
    saved: 0,
    nextCursor: 'older',
  };
  const result = patchFeedPage(
    oldCache,
    { ...filters, unread: true },
    { ...item, read: true },
    { read: true },
  );
  expect(result).toMatchObject({ items: [], total: 64, matchingUnread: 64 });
});
it('filters mixed platform pages and status counts before pagination', async () => {
  await getPool().query('UPDATE items SET read=false WHERE user_id=$1', [userId]);
  const youtube = await getFeedPage(userId, { ...filters, platform: 'youtube' });
  const github = await getFeedPage(userId, { ...filters, platform: 'github' });
  expect(youtube.total).toBe(32);
  expect(youtube.items.every((item) => item.platform === 'youtube')).toBe(true);
  expect(github.total).toBe(33);
  expect(github.items.every((item) => item.platform === 'github')).toBe(true);
  const status = await getFeedStatus(userId, { ...filters, platform: 'youtube' });
  expect(status).toMatchObject({ total: 32, matchingUnread: 32, unread: 65, saved: 33, all: 65 });
  expect(await markFeedRead(userId, { ...filters, platform: 'youtube', unread: true })).toBe(32);
  expect((await getFeedPage(userId, { ...filters, platform: 'youtube', unread: true })).total).toBe(
    0,
  );
  expect((await getFeedPage(userId, { ...filters, platform: 'github', unread: true })).total).toBe(
    33,
  );
});
