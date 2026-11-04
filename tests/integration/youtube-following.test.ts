import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { migrate } from '../../scripts/migrate';
import { getPool } from '../../src/server/db/client';
import {
  previewYouTubeFollowing,
  importYouTubeFollowing,
} from '../../src/server/platforms/youtube-following';
import { disconnectYouTube } from '../../src/server/platforms/youtube-auth';
import { persistSubscription } from '../../src/server/subscriptions/service';
import { connectTestYouTube, googleFixture } from '../helpers/youtube-oauth';

let user: string;
let fixture: ReturnType<typeof googleFixture>;
const id = (number: number) => `UC${String(number).padStart(22, '0')}`;
const item = (number: number) => ({
  snippet: {
    title: `Channel ${number}`,
    description: 'Followed channel',
    resourceId: { channelId: id(number) },
  },
});
const preview = (input: unknown = {}) =>
  previewYouTubeFollowing(user, input, undefined, fixture.fetcher);
const importChannels = (previewId: string, numbers: number[]) =>
  importYouTubeFollowing(
    user,
    { previewId, channelIds: numbers.map(id) },
    undefined,
    fixture.fetcher,
  );
beforeAll(async () => {
  await migrate();
});
beforeEach(async () => {
  vi.stubEnv('APP_MODE', 'demo');
  vi.stubEnv('YOUTUBE_CLIENT_ID', 'youtube-test-client');
  vi.stubEnv('YOUTUBE_CLIENT_SECRET', 'youtube-test-secret');
  vi.stubEnv('BETTER_AUTH_SECRET', 'youtube-test-encryption-secret-at-least-32-chars');
  vi.stubEnv('YOUTUBE_API_KEY', '');
  user = `youtube-follow-${randomUUID()}`;
  fixture = googleFixture();
  await getPool().query('INSERT INTO app_users(id,name) VALUES($1,$1)', [user]);
  await connectTestYouTube(user, fixture.fetcher);
});
afterEach(async () => {
  for (const table of ['jobs', 'subscriptions', 'platform_connections'])
    await getPool().query(`DELETE FROM ${table} WHERE user_id=$1`, [user]);
  await getPool().query("DELETE FROM system_state WHERE value->>'userId'=$1", [user]);
  await getPool().query('DELETE FROM app_users WHERE id=$1', [user]);
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await getPool().end();
});

it('reads only the authorized account, paginates and deduplicates while preserving cross-page import choices', async () => {
  fixture.state.subscriptionPages.set('', {
    items: [item(1), item(2), item(1)],
    nextPageToken: 'opaque-page-2',
  });
  fixture.state.subscriptionPages.set('opaque-page-2', { items: [item(2), item(3)] });
  const first = await preview();
  expect(first.channels.map((channel) => channel.id)).toEqual([id(1), id(2)]);
  const second = await preview({ previewId: first.previewId, cursor: first.nextCursor });
  expect(second.nextCursor).toBeNull();
  const result = await importChannels(first.previewId, [1, 3]);
  expect(result.added).toHaveLength(2);
  expect(result.failed).toEqual([]);
  const reads = fixture.requests.filter((request) =>
    request.url.pathname.endsWith('/subscriptions'),
  );
  expect(reads).toHaveLength(2);
  for (const request of reads) {
    expect(request.url.searchParams.get('mine')).toBe('true');
    expect(request.url.searchParams.get('maxResults')).toBe('50');
    expect(request.url.searchParams.has('key')).toBe(false);
  }
  expect(
    fixture.requests.filter(
      (request) =>
        request.url.pathname.endsWith('/channels') && !request.url.searchParams.has('mine'),
    ),
  ).toHaveLength(1);
  expect(fixture.requests.some((request) => request.url.pathname.endsWith('/search'))).toBe(false);
});

it('creates one source and one sync job per channel and marks existing subscriptions on subsequent reads', async () => {
  fixture.state.subscriptionPages.set('', { items: [item(1)] });
  const first = await preview();
  const initial = await importChannels(first.previewId, [1]);
  const repeated = await importChannels(first.previewId, [1]);
  expect(initial.receipt).toEqual({ created: 1, existing: 0, failed: 0 });
  expect(repeated.receipt).toEqual({ created: 0, existing: 1, failed: 0 });
  expect(repeated.added[0].id).toBe(initial.added[0].id);
  expect(initial.added[0]).toMatchObject({
    platform: 'youtube',
    kind: 'channel',
    enabled: true,
    adapterData: { uploadsPlaylistId: `uploads-${id(1)}` },
  });
  expect(
    (await getPool().query('SELECT count(*) FROM jobs WHERE user_id=$1', [user])).rows[0].count,
  ).toBe('1');
  expect((await preview()).channels[0].subscribed).toBe(true);
});

it('replays a committed next page after a lost response without another Google request or page advance', async () => {
  fixture.state.subscriptionPages.set('', { items: [item(1)], nextPageToken: 'page-two' });
  fixture.state.subscriptionPages.set('page-two', {
    items: [item(2)],
    nextPageToken: 'page-three',
  });
  const first = await preview();
  const second = await preview({ previewId: first.previewId, cursor: first.nextCursor });
  const count = fixture.requests.length;
  const retried = await preview({ previewId: first.previewId, cursor: first.nextCursor });
  expect(retried).toEqual(second);
  expect(fixture.requests).toHaveLength(count);
  const cached = (
    await getPool().query('SELECT value FROM system_state WHERE key=$1', [
      `youtube-follow-preview:${user}:${first.previewId}`,
    ])
  ).rows[0].value;
  expect(cached.pages).toBe(2);
  expect((await importChannels(first.previewId, [1, 2])).added).toHaveLength(2);
  expect(
    (await preview({ previewId: first.previewId, cursor: first.nextCursor })).channels[0]
      .subscribed,
  ).toBe(true);
});

it('rejects arbitrary channel imports, arbitrary cursors and unexpected search parameters before making requests', async () => {
  fixture.state.subscriptionPages.set('', { items: [item(1)], nextPageToken: 'next' });
  const first = await preview();
  const count = fixture.requests.length;
  await expect(importChannels(first.previewId, [2])).rejects.toThrow('只能导入');
  await expect(preview({ cursor: 'invented' })).rejects.toThrow('分页参数');
  await expect(preview({ previewId: first.previewId, cursor: 'invented' })).rejects.toThrow(
    '已过期',
  );
  await expect(preview({ username: 'someone-else' })).rejects.toThrow();
  await expect(importChannels(first.previewId, [1, 1])).rejects.toThrow('重复');
  expect(fixture.requests).toHaveLength(count);
});

it('binds previews to the current user and expiration, and invalidates obsolete reads', async () => {
  fixture.state.subscriptionPages.set('', { items: [item(1)] });
  const first = await preview();
  const other = `youtube-other-${randomUUID()}`;
  await getPool().query('INSERT INTO app_users(id,name) VALUES($1,$1)', [other]);
  try {
    await connectTestYouTube(other, fixture.fetcher);
    await expect(
      importYouTubeFollowing(
        other,
        { previewId: first.previewId, channelIds: [id(1)] },
        undefined,
        fixture.fetcher,
      ),
    ).rejects.toThrow('已过期');
  } finally {
    await getPool().query('DELETE FROM platform_connections WHERE user_id=$1', [other]);
    await getPool().query('DELETE FROM app_users WHERE id=$1', [other]);
  }
  await getPool().query(
    "UPDATE system_state SET value=jsonb_set(value,'{expiresAt}','0'::jsonb) WHERE key=$1",
    [`youtube-follow-preview:${user}:${first.previewId}`],
  );
  await expect(importChannels(first.previewId, [1])).rejects.toThrow('已过期');
  const old = await preview();
  await preview();
  await expect(importChannels(old.previewId, [1])).rejects.toThrow('已过期');
});

it('retains successful imports and permits a failed channel to be retried without duplicate jobs', async () => {
  fixture.state.subscriptionPages.set('', { items: [item(1), item(2)] });
  const first = await preview();
  fixture.state.missingChannels.add(id(2));
  const partial = await importChannels(first.previewId, [1, 2]);
  expect(partial.added).toHaveLength(1);
  expect(partial.failed).toMatchObject([{ id: id(2), name: 'Channel 2' }]);
  fixture.state.missingChannels.clear();
  expect((await importChannels(first.previewId, [2])).added).toHaveLength(1);
  expect(
    (await getPool().query('SELECT count(*) FROM subscriptions WHERE user_id=$1', [user])).rows[0]
      .count,
  ).toBe('2');
});

it('enforces the 50 channel cap transactionally while allowing an already imported channel', async () => {
  for (let number = 1; number <= 49; number++)
    await persistSubscription(
      user,
      'channel',
      {
        externalId: id(number),
        name: `Existing ${number}`,
        description: '',
        url: `https://www.youtube.com/channel/${id(number)}`,
      },
      { platform: 'youtube' },
    );
  fixture.state.subscriptionPages.set('', { items: [item(1), item(50), item(51)] });
  const first = await preview();
  expect(first.channels[0].subscribed).toBe(true);
  const result = await importChannels(first.previewId, [1, 50, 51]);
  expect(result.added).toHaveLength(2);
  expect(result.failed[0]).toMatchObject({ id: id(51) });
  expect(result.failed[0].error).toContain('上限');
  expect(
    (await getPool().query('SELECT count(*) FROM subscriptions WHERE user_id=$1', [user])).rows[0]
      .count,
  ).toBe('50');
});

it('fences an import whose channel lookup returns after the account has been disconnected', async () => {
  fixture.state.subscriptionPages.set('', { items: [item(1)] });
  const first = await preview();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const importing = importYouTubeFollowing(
    user,
    { previewId: first.previewId, channelIds: [id(1)] },
    undefined,
    async (input, init) => {
      const response = await fixture.fetcher(input, init);
      if (new URL(String(input)).pathname.endsWith('/channels')) {
        entered.resolve();
        await release.promise;
      }
      return response;
    },
  );
  await entered.promise;
  await disconnectYouTube(user, fixture.fetcher);
  release.resolve();
  const result = await importing;
  expect(result.added).toEqual([]);
  expect(result.failed[0].error).toContain('账号已变化');
  expect(result.previewInvalidated).toBe(true);
  expect(
    (await getPool().query('SELECT count(*) FROM subscriptions WHERE user_id=$1', [user])).rows[0]
      .count,
  ).toBe('0');
  await expect(preview()).rejects.toThrow('尚未连接');
});

it('returns a clear empty state, skips unavailable IDs, and bounds a long following list to 20 pages', async () => {
  expect((await preview()).channels).toEqual([]);
  fixture.state.subscriptionPages.set('', {
    items: [{ snippet: { title: 'Unavailable', resourceId: { channelId: 'removed' } } }, item(1)],
    nextPageToken: 'page',
  });
  const first = await preview();
  expect(first.channels).toHaveLength(1);
  await getPool().query(
    "UPDATE system_state SET value=jsonb_set(value,'{pages}','19'::jsonb) WHERE key=$1",
    [`youtube-follow-preview:${user}:${first.previewId}`],
  );
  fixture.state.subscriptionPages.set('page', { items: [item(2)], nextPageToken: 'never-fetch' });
  const last = await preview({ previewId: first.previewId, cursor: 'page' });
  expect(last).toMatchObject({ truncated: true, nextCursor: null });
});
