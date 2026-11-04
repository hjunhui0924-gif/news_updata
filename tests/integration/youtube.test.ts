import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { migrate } from '../../scripts/migrate';
import { getPool } from '../../src/server/db/client';
import { getItems, getSubscriptions, patchItemState } from '../../src/server/db/store';
import { addSubscription, syncSubscription } from '../../src/server/subscriptions/service';
import { YouTubeAdapter, type YouTubeTransport } from '../../src/server/platforms/youtube';
import { PlatformError } from '../../src/server/platforms/contract';
import { enqueueAi } from '../../src/server/ai/enqueue';
import { runAi } from '../../src/server/ai/service';

process.env.APP_MODE = 'demo';
const user = `youtube-${randomUUID()}`;
const channel = `UC${'a'.repeat(22)}`;
const now = new Date().toISOString();
let description = 'A channel description, not the full video.';
let failSecond = true;
const transport: YouTubeTransport = async (resource, parameters) => {
  if (resource === 'channels')
    return {
      items: [
        {
          id: channel,
          snippet: { title: 'My channel', description: 'About' },
          contentDetails: { relatedPlaylists: { uploads: 'uploads-one' } },
        },
      ],
    };
  if (resource === 'playlistItems') {
    if (parameters.pageToken && failSecond)
      throw new PlatformError('YouTube 暂时限制请求。', 429, 120);
    return {
      items: [
        { contentDetails: { videoId: parameters.pageToken ? 'bcdefghijkl' : 'abcdefghijk' } },
      ],
      ...(!parameters.pageToken ? { nextPageToken: 'opaque-second' } : {}),
    };
  }
  return {
    items: [
      {
        id: parameters.id,
        snippet: {
          channelId: channel,
          title: 'A useful video',
          channelTitle: 'My channel',
          description,
          publishedAt: now,
          liveBroadcastContent: 'none',
        },
        status: { privacyStatus: 'public', uploadStatus: 'processed' },
      },
    ],
  };
};
const adapter = new YouTubeAdapter(transport);
beforeAll(async () => {
  await migrate();
  await getPool().query('INSERT INTO app_users(id,name) VALUES($1,$2)', [user, 'test']);
});
afterAll(async () => {
  for (const table of ['jobs', 'items', 'subscriptions'])
    await getPool().query(`DELETE FROM ${table} WHERE user_id=$1`, [user]);
  await getPool().query('DELETE FROM system_state WHERE key LIKE $1', [`%${user}%`]);
  await getPool().query('DELETE FROM app_users WHERE id=$1', [user]);
  await getPool().end();
});
it('uses stable channel identity for aliases and saves no API credentials', async () => {
  const first = await addSubscription(user, 'channel', '@one', adapter, 'youtube');
  expect((await addSubscription(user, 'channel', '@renamed', adapter, 'youtube')).id).toBe(
    first.id,
  );
  expect(await getSubscriptions(user)).toHaveLength(1);
  expect(first).toMatchObject({
    platform: 'youtube',
    adapterData: { uploadsPlaylistId: 'uploads-one' },
  });
  expect(JSON.stringify(first)).not.toContain('API_KEY');
});
it('keeps the first page on a rate-limit failure, persists retry time and resumes later', async () => {
  const [sub] = await getSubscriptions(user);
  await expect(syncSubscription(user, sub.id, adapter)).rejects.toMatchObject({ status: 429 });
  const [partial] = await getSubscriptions(user);
  expect(partial.coverage).toBe('partial');
  expect(Date.parse(partial.retryAt!)).toBeGreaterThan(Date.now());
  expect(await getItems(user)).toHaveLength(1);
  await expect(syncSubscription(user, sub.id, adapter)).rejects.toMatchObject({ status: 429 });
  await getPool().query("UPDATE subscriptions SET data=data - 'retryAt' WHERE user_id=$1", [user]);
  failSecond = false;
  await syncSubscription(user, sub.id, adapter);
  expect(await getItems(user)).toHaveLength(2);
  expect((await getSubscriptions(user))[0].coverage).toBe('complete');
});
it('preserves saved/read state after description changes and does not enqueue full-video AI', async () => {
  const [sub] = await getSubscriptions(user);
  const [first] = await getItems(user);
  await patchItemState(user, first.id, { read: true, saved: true });
  description = 'The edited description.';
  await syncSubscription(user, sub.id, adapter);
  const updated = (await getItems(user)).find((item) => item.id === first.id)!;
  expect(updated).toMatchObject({
    read: true,
    saved: true,
    body: description,
    type: 'video',
    platform: 'youtube',
    aiStatus: 'insufficient',
  });
  expect(
    (
      await getPool().query(
        "SELECT * FROM jobs WHERE user_id=$1 AND kind IN ('summary','translation')",
        [user],
      )
    ).rows,
  ).toEqual([]);
  await expect(enqueueAi(user, first.id, 'summary')).rejects.toThrow('视频简介');
  await expect(enqueueAi(user, first.id, 'translation')).rejects.toThrow('视频简介');
  let called = false;
  await expect(
    runAi(user, first.id, 'summary', async () => {
      called = true;
      throw new Error('must not call');
    }),
  ).rejects.toThrow('视频简介');
  expect(called).toBe(false);
});

it('returns to the head after an old archive page so new uploads cannot starve behind thousands of old videos', async () => {
  let latest = false;
  let playlistCalls = 0;
  const archive = new YouTubeAdapter(async (resource, parameters) => {
    if (resource === 'channels') return transport(resource, parameters);
    if (resource === 'playlistItems') {
      playlistCalls++;
      expect(parameters.pageToken).toBeUndefined();
      return {
        items: [
          {
            contentDetails: {
              videoId: 'cdefghijklm',
              videoPublishedAt: latest ? new Date().toISOString() : '2020-01-01T00:00:00Z',
            },
          },
        ],
        nextPageToken: 'ten-thousand-old-videos',
      };
    }
    return {
      items: [
        {
          id: 'cdefghijklm',
          snippet: {
            channelId: channel,
            channelTitle: 'My channel',
            title: latest ? 'Brand new upload' : 'Old upload',
            description: 'A description',
            publishedAt: latest ? new Date().toISOString() : '2020-01-01T00:00:00Z',
          },
          status: { privacyStatus: 'public', uploadStatus: 'processed' },
        },
      ],
    };
  });
  const [sub] = await getSubscriptions(user);
  // Once the new first page is read, the next page is deliberately old and ends the scan.
  const original = archive.readPage.bind(archive);
  archive.readPage = async (source, stream, request) => {
    if (request.cursor && latest) return { items: [], hasNext: false, pageSize: 0 };
    return original(source, stream, request);
  };
  await syncSubscription(user, sub.id, archive);
  latest = true;
  await syncSubscription(user, sub.id, archive);
  expect(playlistCalls).toBe(2);
  expect((await getItems(user)).find((item) => item.externalId === 'cdefghijklm')?.title).toBe(
    'Brand new upload',
  );
});
