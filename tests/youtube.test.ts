import { expect, it, vi } from 'vitest';
import {
  YouTubeAdapter,
  createYouTubeTransport,
  parseYouTubeSource,
  youtubeThumbnail,
} from '../src/server/platforms/youtube';
import { CursorExpiredError } from '../src/server/platforms/contract';
import type { Subscription } from '../src/shared/types';

const channel = `UC${'a'.repeat(22)}`;
const source: Subscription = {
  id: 'one',
  platform: 'youtube',
  externalId: channel,
  kind: 'channel',
  name: 'A channel',
  description: '',
  url: `https://www.youtube.com/channel/${channel}`,
  enabled: true,
  priority: false,
  demo: false,
  createdAt: new Date().toISOString(),
  lastSyncAt: null,
  error: null,
  coverage: 'pending',
  adapterData: { uploadsPlaylistId: 'UU-upload-list' },
};
function video(id: string, options: { channelId?: string; privacy?: string; live?: string } = {}) {
  return {
    id,
    snippet: {
      channelId: options.channelId ?? channel,
      title: 'A useful video',
      description: 'A description, not a transcript.',
      channelTitle: 'A channel',
      publishedAt: '2026-11-04T00:00:00Z',
      liveBroadcastContent: options.live ?? 'none',
      thumbnails: { medium: { url: 'https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg' } },
    },
    status: { privacyStatus: options.privacy ?? 'public', uploadStatus: 'processed' },
  };
}
it('accepts stable channel IDs, Unicode handles and canonical channel URLs', () => {
  expect(parseYouTubeSource(channel)).toEqual({ id: channel });
  expect(parseYouTubeSource(' @频道名字 ')).toEqual({ forHandle: '@频道名字' });
  expect(parseYouTubeSource('https://www.youtube.com/@example/videos')).toEqual({
    forHandle: '@example',
  });
  expect(parseYouTubeSource(`https://youtube.com/channel/${channel}/`)).toEqual({ id: channel });
});
it.each([
  'http://www.youtube.com/@example',
  'https://youtube.com.evil.test/@example',
  'https://youtube.com@evil.test/@example',
  'https://www.youtube.com:8443/@example',
  'https://www.youtube.com/@example?x=y',
  'https://www.youtube.com/watch?v=abcdefghijk',
  'https://www.youtube.com/c/legacy',
  'https://www.youtube.com/@one%2Ftwo',
  'http://127.0.0.1:3000',
  'https://youtu.be/abcdefghijk',
])('rejects unsupported or unsafe channel input %s', (value) => {
  expect(() => parseYouTubeSource(value)).toThrow();
});
it('resolves aliases to stable source identities and the uploads playlist without account secrets', async () => {
  const transport = vi.fn(async () => ({
    items: [
      {
        id: channel,
        snippet: { title: 'A channel', description: 'About' },
        contentDetails: { relatedPlaylists: { uploads: 'UU-upload-list' } },
      },
    ],
  }));
  const adapter = new YouTubeAdapter(transport);
  expect(await adapter.resolve('channel', '@one')).toMatchObject({
    externalId: channel,
    adapterData: { uploadsPlaylistId: 'UU-upload-list' },
    url: `https://www.youtube.com/channel/${channel}`,
  });
  expect(transport).toHaveBeenCalledWith('channels', {
    part: 'snippet,contentDetails',
    forHandle: '@one',
  });
  await expect(adapter.resolve('repo', '@one')).rejects.toThrow('频道订阅');
});
it('treats explicit zero results as empty for channels, uploads and deleted videos without accepting malformed payloads', async () => {
  const empty = { pageInfo: { totalResults: 0 } };
  const transport = vi.fn(async () => empty);
  const adapter = new YouTubeAdapter(transport);
  await expect(adapter.resolve('channel', channel)).rejects.toMatchObject({ status: 404 });
  expect(await adapter.resolveMany([channel])).toEqual([]);
  expect((await adapter.readPage(source, 'uploads', { page: 1 })).items).toEqual([]);
  const deleted = new YouTubeAdapter(async (resource) =>
    resource === 'playlistItems'
      ? { items: [{ contentDetails: { videoId: 'abcdefghijk' } }] }
      : empty,
  );
  expect((await deleted.readPage(source, 'uploads', { page: 1 })).items).toEqual([]);
  for (const payload of [
    {},
    { pageInfo: { totalResults: 1 } },
    { pageInfo: { totalResults: 0 }, nextPageToken: 'unexpected' },
    { items: null },
  ]) {
    await expect(
      new YouTubeAdapter(async () => payload).readPage(source, 'uploads', { page: 1 }),
    ).rejects.toThrow('数据格式');
  }
});

it('batches details, preserves opaque page tokens and excludes private, live and unrelated videos', async () => {
  const transport = vi.fn(async (resource: string) =>
    resource === 'playlistItems'
      ? {
          nextPageToken: 'opaque-page-3',
          items: ['abcdefghijk', 'bcdefghijkl', 'cdefghijklm', 'defghijklmn'].map((videoId) => ({
            contentDetails: { videoId },
          })),
        }
      : {
          items: [
            video('abcdefghijk'),
            video('bcdefghijkl', { privacy: 'private' }),
            video('cdefghijklm', { live: 'live' }),
            video('defghijklmn', { channelId: `UC${'b'.repeat(22)}` }),
          ],
        },
  );
  const page = await new YouTubeAdapter(transport).readPage(source, 'uploads', {
    page: 2,
    cursor: 'opaque-page-2',
  });
  expect(transport).toHaveBeenNthCalledWith(1, 'playlistItems', {
    part: 'contentDetails',
    playlistId: 'UU-upload-list',
    maxResults: '50',
    pageToken: 'opaque-page-2',
  });
  expect(transport).toHaveBeenCalledTimes(2);
  expect(page).toMatchObject({ hasNext: true, nextCursor: 'opaque-page-3', pageSize: 4 });
  expect(page.items).toHaveLength(1);
  expect(page.items[0]).toMatchObject({
    type: 'video',
    sourceName: 'A channel',
    body: 'A description, not a transcript.',
    media: { content: 'description' },
  });
  expect(page.items[0]).not.toHaveProperty('repo');
});
it('handles empty/deleted pages without requesting details and rejects malformed provider data', async () => {
  const transport = vi.fn(async () => ({ items: [] }));
  expect(
    (await new YouTubeAdapter(transport).readPage(source, 'uploads', { page: 1 })).items,
  ).toEqual([]);
  expect(transport).toHaveBeenCalledTimes(1);
  await expect(
    new YouTubeAdapter(async () => ({ items: 'invalid' })).resolve('channel', '@one'),
  ).rejects.toThrow('格式');
  await expect(
    new YouTubeAdapter(async () => ({ items: [] })).resolve('channel', '@one'),
  ).rejects.toThrow('没有找到');
});

it('ends an entirely old page and caps even undated/deleted archives at five pages', async () => {
  const old = new YouTubeAdapter(async (resource) =>
    resource === 'playlistItems'
      ? {
          items: [
            {
              contentDetails: { videoId: 'abcdefghijk', videoPublishedAt: '2020-01-01T00:00:00Z' },
            },
          ],
          nextPageToken: 'many-more-old-pages',
        }
      : {
          items: [
            {
              ...video('abcdefghijk'),
              snippet: { ...video('abcdefghijk').snippet, publishedAt: '2020-01-01T00:00:00Z' },
            },
          ],
        },
  );
  expect(await old.readPage(source, 'uploads', { page: 1 })).toMatchObject({
    historyComplete: true,
  });
  const deleted = new YouTubeAdapter(async (resource) =>
    resource === 'playlistItems'
      ? {
          items: [{ contentDetails: { videoId: 'abcdefghijk' } }],
          nextPageToken: 'many-more-deleted-pages',
        }
      : { items: [] },
  );
  expect(await deleted.readPage(source, 'uploads', { page: 5, cursor: 'page-five' })).toMatchObject(
    { historyComplete: true, windowCapped: true },
  );
});
it('allows only canonical HTTPS YouTube thumbnail hosts', () => {
  expect(youtubeThumbnail('https://i.ytimg.com/vi/x/default.jpg')).toBeTruthy();
  for (const url of [
    'http://i.ytimg.com/x',
    'https://i.ytimg.com.evil.test/x',
    'https://user:pass@i.ytimg.com/x',
    'data:image/png;base64,hello',
  ])
    expect(youtubeThumbnail(url)).toBeUndefined();
});
it('never makes a request without a server key or after caller cancellation', async () => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(
    createYouTubeTransport(undefined, fetcher, '')('channels', {}),
  ).rejects.toMatchObject({ status: 503 });
  const abort = new AbortController();
  abort.abort(new Error('cancelled'));
  await expect(
    createYouTubeTransport(abort.signal, fetcher, 'test-key')('channels', {}),
  ).rejects.toThrow('cancelled');
  expect(fetcher).not.toHaveBeenCalled();
});
it('classifies quota failures and suppresses subsequent network attempts with the same key', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json(
        { error: { errors: [{ reason: 'quotaExceeded' }], message: 'untrusted secret' } },
        { status: 403 },
      ),
    );
  const transport = createYouTubeTransport(undefined, fetcher, 'quota-test-key');
  await expect(transport('channels', {})).rejects.toMatchObject({ status: 429, retryAfter: 86400 });
  await expect(transport('channels', {})).rejects.toMatchObject({ status: 429 });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('classifies temporary limits and expired cursors without leaking response messages', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json(
        { error: { errors: [{ reason: 'rateLimitExceeded' }] } },
        { status: 403, headers: { 'retry-after': '120' } },
      ),
    )
    .mockResolvedValueOnce(
      Response.json({ error: { errors: [{ reason: 'invalidPageToken' }] } }, { status: 400 }),
    );
  const transport = createYouTubeTransport(undefined, fetcher, 'rate-test-key');
  await expect(transport('playlistItems', {})).rejects.toMatchObject({
    status: 429,
    retryAfter: 120,
  });
  await expect(transport('playlistItems', {})).rejects.toBeInstanceOf(CursorExpiredError);
});
it('uses a fixed endpoint and redacts API keys from network and provider failures', async () => {
  const key = 'server-only-test-key';
  const fetcher = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new Error(`Failed URL with ${key}`))
    .mockResolvedValueOnce(
      Response.json(
        { error: { errors: [{ reason: 'keyInvalid' }], message: key } },
        { status: 400 },
      ),
    );
  const transport = createYouTubeTransport(undefined, fetcher, key);
  for (let i = 0; i < 2; i++) {
    const error = await transport('channels', { forHandle: '@one' }).catch((error) => error);
    if (!(error instanceof Error)) throw new Error('Expected a classified platform error');
    expect(error.message).not.toContain(key);
    expect(error.message).toContain('YouTube');
  }
  const [url, init] = fetcher.mock.calls[0];
  expect(new URL(String(url)).origin).toBe('https://www.googleapis.com');
  expect(init).toMatchObject({ redirect: 'error', cache: 'no-store' });
});
