import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { migrate } from '../../scripts/migrate';
import { getPool, transaction } from '../../src/server/db/client';
import { getItems, patchItemState, saveItem } from '../../src/server/db/store';
import { persistUpdates } from '../../src/server/subscriptions/ingest';
import { createDemoData } from '../../src/server/demo/fixtures';
import type { FeedItem } from '../../src/shared/types';
import {
  addSubscription,
  deleteSubscription,
  syncSubscription,
} from '../../src/server/subscriptions/service';
import {
  PlatformError,
  CursorExpiredError,
  type PlatformAdapter,
  type SourceUpdate,
} from '../../src/server/platforms/contract';
import { itemExternalKey } from '../../src/shared/platforms';

process.env.APP_MODE = 'demo';
const user = `platform-${randomUUID()}`;
const other = `platform-${randomUUID()}`;
const now = new Date(Date.now() + 1000).toISOString();
let failNext = false;
let title = 'A video';
const requested: (string | undefined)[] = [];
const update = (): SourceUpdate => ({
  externalId: 'same-id',
  type: 'video',
  sourceName: 'A channel',
  author: 'A channel',
  title,
  body: 'Description',
  description: 'Description',
  url: 'https://www.youtube.com/watch?v=abcdefghijk',
  publishedAt: now,
});
const adapter: PlatformAdapter = {
  platform: 'youtube',
  kinds: ['channel'],
  async resolve() {
    return {
      externalId: 'stable-channel',
      name: 'A channel',
      description: '',
      url: 'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv',
    };
  },
  streams() {
    return ['uploads'];
  },
  async readPage(_source, _stream, request) {
    requested.push(request.cursor);
    if (request.cursor && failNext) throw new PlatformError('暂时无法连接 YouTube。');
    return {
      items: [update()],
      hasNext: !request.cursor,
      pageSize: 1,
      ...(!request.cursor ? { nextCursor: 'opaque-next-page' } : {}),
    };
  },
  async materialize(value) {
    return value;
  },
};
beforeAll(async () => {
  await migrate();
  for (const id of [user, other])
    await getPool().query('INSERT INTO app_users(id,name) VALUES($1,$2)', [id, 'test']);
});
afterAll(async () => {
  for (const id of [user, other]) {
    await getPool().query('DELETE FROM jobs WHERE user_id=$1', [id]);
    await getPool().query('DELETE FROM items WHERE user_id=$1', [id]);
    await getPool().query('DELETE FROM subscriptions WHERE user_id=$1', [id]);
    await getPool().query('DELETE FROM system_state WHERE key LIKE $1', [`%${id}%`]);
    await getPool().query('DELETE FROM star_sync_exclusions WHERE user_id=$1', [id]);
    await getPool().query('DELETE FROM app_users WHERE id=$1', [id]);
  }
  await getPool().end();
});
it('uses platform-qualified identities, stable sources and the shared transactional outbox', async () => {
  const sub = await addSubscription(user, 'channel', '@one', adapter, 'youtube');
  const duplicate = await addSubscription(user, 'channel', '@renamed', adapter, 'youtube');
  expect(duplicate.id).toBe(sub.id);
  expect(sub.platform).toBe('youtube');
  const jobs = await getPool().query(
    'SELECT count(*) FROM jobs WHERE user_id=$1 AND target_id=$2',
    [user, sub.id],
  );
  expect(Number(jobs.rows[0].count)).toBe(1);
  expect(itemExternalKey({ type: 'video', externalId: 'same-id', platform: 'youtube' })).not.toBe(
    itemExternalKey({ type: 'video', externalId: 'same-id', platform: 'github' }),
  );
  await expect(addSubscription(user, 'repo', 'anything', adapter, 'youtube')).rejects.toThrow(
    '订阅类型',
  );
  await expect(addSubscription(user, 'repo', 'anything', adapter)).rejects.toThrow('平台与连接器');
});
it('resumes opaque cursors and retains reading state after provider content changes', async () => {
  const sub = await addSubscription(user, 'channel', '@one', adapter, 'youtube');
  failNext = true;
  await expect(syncSubscription(user, sub.id, adapter)).rejects.toThrow('YouTube');
  const [first] = await getItems(user);
  expect(first.platform).toBe('youtube');
  await patchItemState(user, first.id, { read: true, saved: true });
  title = 'Updated description title';
  failNext = false;
  await syncSubscription(user, sub.id, adapter);
  expect(requested).toEqual([undefined, 'opaque-next-page', 'opaque-next-page']);
  const [changed] = await getItems(user);
  expect(changed).toMatchObject({ id: first.id, read: true, saved: true, title });
  expect(await getItems(other)).toEqual([]);
  await syncSubscription(other, sub.id, adapter);
  expect(await getItems(other)).toEqual([]);
  await deleteSubscription(other, sub.id);
  await deleteSubscription(user, sub.id);
  const exclusions = await getPool().query('SELECT * FROM star_sync_exclusions WHERE user_id=$1', [
    user,
  ]);
  expect(exclusions.rows).toEqual([]);
});

it('reuses opaque continuations after a conditional first-page response without skipping later pages', async () => {
  const cursors: (string | undefined)[] = [];
  let pageTwoTitle = 'Original second page';
  const conditional: PlatformAdapter = {
    ...adapter,
    async readPage(_source, _stream, request) {
      cursors.push(request.cursor);
      if (request.page === 1 && request.validator)
        return { items: [], hasNext: true, pageSize: 0, notModified: true };
      return {
        items: [
          {
            ...update(),
            externalId: request.cursor ? 'page-two' : 'page-one',
            ...(request.cursor ? { title: pageTwoTitle } : {}),
          },
        ],
        hasNext: !request.cursor,
        pageSize: 1,
        ...(!request.cursor ? { etag: 'page-one-etag', nextCursor: 'opaque-page-two' } : {}),
      };
    },
  };
  const sub = await addSubscription(user, 'channel', '@one', conditional, 'youtube');
  await syncSubscription(user, sub.id, conditional);
  pageTwoTitle = 'Updated second page';
  await syncSubscription(user, sub.id, conditional);
  expect(cursors).toEqual([undefined, 'opaque-page-two', undefined, 'opaque-page-two']);
  const values = (await getItems(user)).map((item) => item.externalId);
  expect(values).toContain('page-one');
  expect(values).toContain('page-two');
  expect((await getItems(user)).find((item) => item.externalId === 'page-two')?.title).toBe(
    pageTwoTitle,
  );
});

it('discards only the expired source checkpoint and safely restarts without overwriting reading state', async () => {
  let expired = true;
  const cursors: (string | undefined)[] = [];
  const expiring: PlatformAdapter = {
    ...adapter,
    async readPage(_source, _stream, request) {
      cursors.push(request.cursor);
      if (request.cursor && expired) {
        expired = false;
        throw new CursorExpiredError();
      }
      return {
        items: [update()],
        hasNext: !request.cursor,
        pageSize: 1,
        ...(!request.cursor ? { nextCursor: 'expired-token' } : {}),
      };
    },
  };
  const sub = await addSubscription(other, 'channel', '@one', expiring, 'youtube');
  const siblingKey = `sync:${other}:unrelated-source`;
  await getPool().query('INSERT INTO system_state(key,value) VALUES($1,$2)', [
    siblingKey,
    { nextToken: 'must-survive' },
  ]);
  await expect(syncSubscription(other, sub.id, expiring)).rejects.toBeInstanceOf(
    CursorExpiredError,
  );
  const [first] = await getItems(other);
  await patchItemState(other, first.id, { saved: true, read: true });
  expect(
    (await getPool().query('SELECT * FROM system_state WHERE key=$1', [`sync:${other}:${sub.id}`]))
      .rows,
  ).toEqual([]);
  expect(
    (await getPool().query('SELECT value FROM system_state WHERE key=$1', [siblingKey])).rows[0]
      .value,
  ).toEqual({ nextToken: 'must-survive' });
  await syncSubscription(other, sub.id, expiring);
  expect(cursors).toEqual([undefined, 'expired-token', undefined, 'expired-token']);
  expect(await getItems(other)).toHaveLength(1);
  expect((await getItems(other))[0]).toMatchObject({ saved: true, read: true });
});

it.each(['github', 'youtube'] as const)(
  'refreshes %s display metadata without invalidating generated content or reading state',
  async (platform) => {
    const base = createDemoData().items[0];
    const original: FeedItem = {
      ...base,
      id: randomUUID(),
      externalId: `metadata-${platform}`,
      platform,
      type: platform === 'youtube' ? 'video' : 'release',
      demo: false,
      sourceUpdatedAt: '2026-11-04T00:00:00Z',
      sourceName: 'Original source',
      media:
        platform === 'youtube'
          ? { kind: 'video', content: 'description', thumbnailUrl: 'https://i.ytimg.com/old.jpg' }
          : undefined,
      summary: platform === 'youtube' ? null : base.summary,
      aiStatus: platform === 'youtube' ? 'insufficient' : 'ready',
      translation: platform === 'youtube' ? null : 'Cached translation',
      translationBlocks:
        platform === 'youtube'
          ? null
          : [{ original: base.body, translation: 'Cached translation' }],
      read: true,
      saved: true,
      muted: true,
    };
    await saveItem(user, original);
    const jobsBefore = Number(
      (await getPool().query('SELECT count(*) FROM jobs WHERE user_id=$1', [user])).rows[0].count,
    );
    const metadata: FeedItem = {
      ...original,
      id: randomUUID(),
      sourceName: 'Renamed source',
      repo: 'Renamed source',
      author: 'Renamed author',
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
      sourceUpdatedAt: '2026-11-04T00:01:00Z',
      ...(original.media
        ? { media: { ...original.media, thumbnailUrl: 'https://i.ytimg.com/new.jpg' } }
        : { contentUrl: 'https://github.com/example/renamed/releases/tag/v1' }),
      summary: null,
      aiStatus: 'pending',
      translation: null,
      translationBlocks: null,
      firstSeenAt: new Date().toISOString(),
      read: false,
      saved: false,
      muted: false,
    };
    await transaction((client) => persistUpdates(client, user, [metadata]));
    const current = (await getItems(user)).find((item) => item.id === original.id)!;
    expect(current).toMatchObject({
      id: original.id,
      firstSeenAt: original.firstSeenAt,
      contentHash: original.contentHash,
      sourceName: metadata.sourceName,
      author: metadata.author,
      repo: metadata.repo,
      url: metadata.url,
      summary: original.summary,
      aiStatus: original.aiStatus,
      translation: original.translation,
      translationBlocks: original.translationBlocks,
      read: true,
      saved: true,
      muted: true,
    });
    expect(current.media).toEqual(metadata.media);
    expect(current.contentUrl).toEqual(metadata.contentUrl);
    await transaction((client) => persistUpdates(client, user, [original]));
    expect((await getItems(user)).find((item) => item.id === original.id)).toEqual(current);
    // A now-unavailable image is removed, without discarding generated content.
    await transaction((client) =>
      persistUpdates(client, user, [{ ...metadata, media: undefined }]),
    );
    const withoutImage = (await getItems(user)).find((item) => item.id === original.id)!;
    expect(withoutImage.media).toBeUndefined();
    expect(withoutImage.summary).toEqual(original.summary);
    expect(withoutImage.translation).toEqual(original.translation);
    expect(
      Number(
        (await getPool().query('SELECT count(*) FROM jobs WHERE user_id=$1', [user])).rows[0].count,
      ),
    ).toBe(jobsBefore);
  },
);
