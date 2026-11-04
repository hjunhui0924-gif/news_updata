import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getPool, transaction } from '../db/client';
import { PlatformError } from './contract';
import { createUserYouTubeTransport, youtubeConnectionGeneration } from './youtube-auth';
import { YouTubeAdapter } from './youtube';
import { persistSubscription } from '../subscriptions/service';
import type { Subscription, YouTubeFollowingPreview } from '@/shared/types';

const channelId = z.string().regex(/^UC[A-Za-z0-9_-]{22}$/);
const previewInput = z
  .object({ previewId: z.uuid().optional(), cursor: z.string().min(1).max(2000).optional() })
  .strict();
const importInput = z
  .object({
    previewId: z.uuid(),
    channelIds: z
      .array(channelId)
      .min(1)
      .max(50)
      .refine((ids) => new Set(ids).size === ids.length, '请勿重复选择频道。'),
  })
  .strict();
const pageSchema = z.object({
  items: z
    .array(
      z.object({
        snippet: z.object({
          title: z.string().max(1000),
          description: z.string().max(10000).default(''),
          resourceId: z.object({ channelId: z.string() }),
        }),
      }),
    )
    .max(50),
  nextPageToken: z.string().min(1).max(2000).optional(),
});
type Channel = { id: string; name: string; description: string };
type Preview = {
  userId: string;
  generation: string;
  expiresAt: number;
  channels: Channel[];
  nextCursor: string | null;
  pages: number;
  lastPage?: { cursor: string; channels: Channel[]; nextCursor: string | null; truncated: boolean };
};
const keyFor = (userId: string, id: string) => `youtube-follow-preview:${userId}:${id}`;
const stale = () => new PlatformError('关注预览已过期或账号已变化，请重新读取我的关注。', 409);
async function readPreview(userId: string, id: string, generation: string): Promise<Preview> {
  const cached = (
    await getPool().query('SELECT value FROM system_state WHERE key=$1', [keyFor(userId, id)])
  ).rows[0]?.value as Preview | undefined;
  if (
    !cached ||
    cached.userId !== userId ||
    cached.generation !== generation ||
    cached.expiresAt <= Date.now()
  )
    throw stale();
  return cached;
}
async function decorate(
  userId: string,
  previewId: string,
  page: { channels: Channel[]; nextCursor: string | null; truncated: boolean },
): Promise<YouTubeFollowingPreview> {
  const subscribed = new Set(
    (
      await getPool().query(
        "SELECT external_id FROM subscriptions WHERE user_id=$1 AND platform='youtube' AND kind='channel'",
        [userId],
      )
    ).rows.map((row) => row.external_id as string),
  );
  return {
    previewId,
    channels: page.channels.map((channel) => ({
      ...channel,
      subscribed: subscribed.has(channel.id),
    })),
    nextCursor: page.nextCursor,
    truncated: page.truncated,
  };
}

export async function previewYouTubeFollowing(
  userId: string,
  input: unknown,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<YouTubeFollowingPreview> {
  const options = previewInput.parse(input);
  if (!!options.previewId !== !!options.cursor)
    throw new PlatformError('分页参数无效，请重新读取关注。', 400);
  const generation = await youtubeConnectionGeneration(userId);
  const previous = options.previewId
    ? await readPreview(userId, options.previewId, generation)
    : undefined;
  if (options.previewId && previous?.lastPage && previous.lastPage.cursor === options.cursor)
    return decorate(userId, options.previewId, previous.lastPage);
  if (
    previous &&
    (!previous.nextCursor || previous.nextCursor !== options.cursor || previous.pages >= 20)
  )
    throw stale();
  const transport = await createUserYouTubeTransport(userId, signal, fetcher);
  const parsed = pageSchema.safeParse(
    await transport('subscriptions', {
      part: 'snippet',
      mine: 'true',
      maxResults: '50',
      ...(options.cursor ? { pageToken: options.cursor } : {}),
    }),
  );
  if (!parsed.success) throw new PlatformError('YouTube 关注列表暂不可读取，请稍后重试。');
  const channels: Channel[] = [
    ...new Map(
      parsed.data.items
        .flatMap(({ snippet }) =>
          channelId.safeParse(snippet.resourceId.channelId).success
            ? [
                {
                  id: snippet.resourceId.channelId,
                  name: snippet.title.slice(0, 200),
                  description: snippet.description.slice(0, 1000),
                },
              ]
            : [],
        )
        .map((channel) => [channel.id, channel]),
    ).values(),
  ];
  const all = [
    ...new Map(
      [...(previous?.channels ?? []), ...channels].map((channel) => [channel.id, channel]),
    ).values(),
  ].slice(0, 1000);
  const pages = (previous?.pages ?? 0) + 1;
  const truncated = !!parsed.data.nextPageToken && (pages >= 20 || all.length >= 1000);
  const nextCursor = truncated ? null : (parsed.data.nextPageToken ?? null);
  const previewId = options.previewId ?? randomUUID();
  const value: Preview = {
    userId,
    generation,
    channels: all,
    pages,
    nextCursor,
    expiresAt: previous?.expiresAt ?? Date.now() + 15 * 60000,
    ...(options.cursor
      ? { lastPage: { cursor: options.cursor, channels, nextCursor, truncated } }
      : {}),
  };
  const responsePage = await transaction(async (client) => {
    const connection = await client.query(
      "SELECT 1 FROM platform_connections WHERE user_id=$1 AND platform='youtube' AND generation=$2 AND state='connected' FOR SHARE",
      [userId, generation],
    );
    if (!connection.rowCount) throw stale();
    if (previous) {
      const current = (
        await client.query('SELECT value FROM system_state WHERE key=$1 FOR UPDATE', [
          keyFor(userId, previewId),
        ])
      ).rows[0]?.value as Preview | undefined;
      if (
        current &&
        current.expiresAt > Date.now() &&
        current.generation === generation &&
        current.lastPage &&
        current.lastPage.cursor === options.cursor
      )
        return current.lastPage;
      if (
        !current ||
        current.nextCursor !== options.cursor ||
        current.pages !== previous.pages ||
        current.expiresAt <= Date.now()
      )
        throw stale();
    }
    signal?.throwIfAborted();
    await client.query(
      "DELETE FROM system_state WHERE key LIKE 'youtube-follow-preview:%' AND (value->>'expiresAt')::bigint <= $1",
      [Date.now()],
    );
    // Starting a fresh read discards this user's obsolete previews and bounds storage.
    if (!previous)
      await client.query(
        "DELETE FROM system_state WHERE key LIKE 'youtube-follow-preview:%' AND value->>'userId'=$1",
        [userId],
      );
    await client.query(
      'INSERT INTO system_state(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      [keyFor(userId, previewId), value],
    );
    return { channels, nextCursor, truncated };
  });
  return decorate(userId, previewId, responsePage);
}

export async function importYouTubeFollowing(
  userId: string,
  input: unknown,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  const options = importInput.parse(input);
  const generation = await youtubeConnectionGeneration(userId);
  const preview = await readPreview(userId, options.previewId, generation);
  const known = new Map(preview.channels.map((channel) => [channel.id, channel]));
  if (options.channelIds.some((id) => !known.has(id)))
    throw new PlatformError('只能导入本次读取的关注频道，请重新选择。', 400);
  const adapter = new YouTubeAdapter(await createUserYouTubeTransport(userId, signal, fetcher));
  const resolved = await adapter.resolveMany(options.channelIds);
  const added: Subscription[] = [];
  const failed: { id: string; name: string; error: string }[] = [];
  for (const id of options.channelIds) {
    signal?.throwIfAborted();
    const channel = resolved.find((channel) => channel.externalId === id);
    if (!channel) {
      failed.push({ id, name: known.get(id)!.name, error: '频道暂不可读取，请稍后重试。' });
      continue;
    }
    try {
      const result = await persistSubscription(userId, 'channel', channel, {
        platform: 'youtube',
        connectionGeneration: generation,
        signal,
      });
      if (result) added.push(result.subscription);
    } catch (error) {
      signal?.throwIfAborted();
      failed.push({
        id,
        name: known.get(id)!.name,
        error: error instanceof PlatformError ? error.message : '导入暂时失败，请稍后重试。',
      });
    }
  }
  return { added, failed };
}
