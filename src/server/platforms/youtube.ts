import { z } from 'zod';
import { getConfig } from '../config';
import {
  CursorExpiredError,
  PlatformError,
  type PlatformAdapter,
  type PageRequest,
  type SourceUpdate,
  type UpdatePage,
} from './contract';
import type { Subscription } from '@/shared/types';
import type { SourceKind } from '@/shared/platforms';

type Resource = 'channels' | 'playlistItems' | 'videos';
export type YouTubeTransport = (
  resource: Resource,
  parameters: Record<string, string>,
) => Promise<unknown>;
const channelId = /^UC[A-Za-z0-9_-]{22}$/;
const videoId = /^[A-Za-z0-9_-]{11}$/;
const handle = /^@[\p{L}\p{M}\p{N}_.·-]{1,100}$/u;
const channelSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().regex(channelId),
      snippet: z.object({ title: z.string(), description: z.string().default('') }),
      contentDetails: z.object({
        relatedPlaylists: z.object({ uploads: z.string().min(1).max(200) }),
      }),
    }),
  ),
});
const playlistSchema = z.object({
  items: z
    .array(
      z.object({
        contentDetails: z.object({
          videoId: z.string(),
          videoPublishedAt: z.iso.datetime().optional(),
        }),
      }),
    )
    .max(50),
  nextPageToken: z.string().min(1).max(2000).optional(),
});
const videoSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().regex(videoId),
        snippet: z.object({
          channelId: z.string().regex(channelId),
          title: z.string(),
          description: z.string().default(''),
          channelTitle: z.string(),
          publishedAt: z.iso.datetime(),
          liveBroadcastContent: z.string().optional(),
          thumbnails: z.record(z.string(), z.object({ url: z.string() })).optional(),
        }),
        status: z.object({ privacyStatus: z.string(), uploadStatus: z.string() }),
      }),
    )
    .max(50),
});

function decode<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new PlatformError('YouTube 返回的数据格式暂不可读取，请稍后重试。');
  return parsed.data;
}

export function parseYouTubeSource(input: string): { id: string } | { forHandle: string } {
  let value = input.trim().replace(/\/$/, '');
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (
        url.protocol !== 'https:' ||
        !['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname) ||
        url.username ||
        url.password ||
        url.port ||
        url.search ||
        url.hash
      )
        throw new Error();
      const path = decodeURIComponent(url.pathname).replace(/\/$/, '');
      const match = path.match(
        /^\/(channel\/UC[A-Za-z0-9_-]{22}|@[^/]+)(?:\/(?:videos|shorts|streams|featured))?$/,
      );
      if (!match) throw new Error();
      value = match[1].replace(/^channel\//, '');
    } catch {
      throw new PlatformError('请输入 YouTube 频道 ID、@handle 或规范频道地址。', 400);
    }
  }
  if (channelId.test(value)) return { id: value };
  if (handle.test(value)) return { forHandle: value };
  throw new PlatformError(
    '请输入 YouTube 频道 ID、@handle 或规范频道地址；暂不支持视频、/c/ 和 /user/ 地址。',
    400,
  );
}

// Shared by requests in this process; per-subscription retryAt is also durable in PostgreSQL.
let quotaCooldown: { key: string; until: number } | undefined;
export function createYouTubeTransport(
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
  key = getConfig().YOUTUBE_API_KEY,
): YouTubeTransport {
  return async (resource, parameters) => {
    signal?.throwIfAborted();
    if (!key)
      throw new PlatformError(
        '尚未配置 YouTube API Key，请在服务端设置 YOUTUBE_API_KEY 后重启 Web 和 Worker。',
        503,
      );
    if (quotaCooldown?.key === key && quotaCooldown.until > Date.now())
      throw new PlatformError(
        'YouTube 配额暂不可用，稍后会自动重试。',
        429,
        Math.ceil((quotaCooldown.until - Date.now()) / 1000),
      );
    const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
    for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
    url.searchParams.set('key', key);
    try {
      const response = await fetcher(url, {
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
          : AbortSignal.timeout(15000),
        cache: 'no-store',
        redirect: 'error',
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const parsed = z
          .object({
            error: z.object({ errors: z.array(z.object({ reason: z.string() })).default([]) }),
          })
          .safeParse(data);
        const reasons = parsed.success ? parsed.data.error.errors.map((error) => error.reason) : [];
        if (reasons.includes('quotaExceeded') || reasons.includes('dailyLimitExceeded')) {
          quotaCooldown = { key, until: Date.now() + 86400000 };
          throw new PlatformError('YouTube API 配额不足，已暂停请求，24 小时后再试。', 429, 86400);
        }
        if (reasons.includes('invalidPageToken')) throw new CursorExpiredError();
        if (
          response.status === 429 ||
          reasons.some((reason) => ['rateLimitExceeded', 'userRateLimitExceeded'].includes(reason))
        ) {
          const delay = Math.min(
            86400,
            Math.max(60, Number(response.headers.get('retry-after')) || 60),
          );
          throw new PlatformError('YouTube 暂时限制请求，请稍后重试。', 429, delay);
        }
        if (response.status === 404)
          throw new PlatformError('YouTube 频道或上传列表不存在，或已不可公开访问。', 404);
        if ([400, 401, 403].includes(response.status))
          throw new PlatformError(
            'YouTube API 配置不可用，请检查服务端密钥、API 启用状态与限制设置。',
            503,
          );
        throw new PlatformError('YouTube 服务暂时不可用，已有内容仍可阅读。');
      }
      return data;
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof PlatformError) throw error;
      throw new PlatformError('暂时无法读取 YouTube，请检查服务器网络后重试；已有内容仍可阅读。');
    }
  };
}

export function youtubeThumbnail(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol === 'https:' &&
      ['i.ytimg.com', 'img.youtube.com'].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port
    )
      return url.toString();
  } catch {}
  return undefined;
}

export class YouTubeAdapter implements PlatformAdapter {
  readonly platform = 'youtube' as const;
  readonly kinds = ['channel'] as const;
  constructor(private readonly transport: YouTubeTransport = createYouTubeTransport()) {}
  async resolve(kind: SourceKind, input: string) {
    if (kind !== 'channel') throw new PlatformError('YouTube 当前只支持频道订阅。', 400);
    const parameters = parseYouTubeSource(input);
    const response = decode(
      channelSchema,
      await this.transport('channels', { part: 'snippet,contentDetails', ...parameters }),
    );
    const channel = response.items[0];
    if (!channel) throw new PlatformError('没有找到可公开访问的 YouTube 频道。', 404);
    if ('id' in parameters && channel.id !== parameters.id)
      throw new PlatformError('YouTube 返回的频道身份不匹配。');
    return {
      externalId: channel.id,
      name: channel.snippet.title,
      description: channel.snippet.description.slice(0, 1000),
      url: `https://www.youtube.com/channel/${channel.id}`,
      adapterData: { uploadsPlaylistId: channel.contentDetails.relatedPlaylists.uploads },
    };
  }
  streams() {
    return ['uploads'];
  }
  async readPage(source: Subscription, _stream: string, request: PageRequest): Promise<UpdatePage> {
    const playlist =
      source.adapterData?.uploadsPlaylistId ??
      (await this.resolve('channel', source.externalId)).adapterData.uploadsPlaylistId;
    const page = decode(
      playlistSchema,
      await this.transport('playlistItems', {
        part: 'contentDetails',
        playlistId: playlist,
        maxResults: '50',
        ...(request.cursor ? { pageToken: request.cursor } : {}),
      }),
    );
    const ids = [
      ...new Set(
        page.items.map((item) => item.contentDetails.videoId).filter((id) => videoId.test(id)),
      ),
    ];
    const videos = ids.length
      ? decode(
          videoSchema,
          await this.transport('videos', { part: 'snippet,status', id: ids.join(',') }),
        ).items
      : [];
    const requestedIds = new Set(ids);
    const updates: SourceUpdate[] = videos
      .filter(
        (video) =>
          requestedIds.has(video.id) &&
          video.snippet.channelId === source.externalId &&
          video.status.privacyStatus === 'public' &&
          video.status.uploadStatus === 'processed' &&
          Date.parse(video.snippet.publishedAt) <= Date.now() &&
          (!video.snippet.liveBroadcastContent || video.snippet.liveBroadcastContent === 'none'),
      )
      .map((video) => ({
        externalId: video.id,
        type: 'video',
        sourceName: video.snippet.channelTitle,
        author: video.snippet.channelTitle,
        title: video.snippet.title,
        description: video.snippet.description.slice(0, 360),
        body: video.snippet.description.slice(0, 10000),
        url: `https://www.youtube.com/watch?v=${video.id}`,
        publishedAt: video.snippet.publishedAt,
        media: {
          kind: 'video',
          content: 'description',
          thumbnailUrl: youtubeThumbnail(
            (video.snippet.thumbnails?.medium ?? video.snippet.thumbnails?.default)?.url,
          ),
        },
      }));
    const dates = new Map(videos.map((video) => [video.id, video.snippet.publishedAt]));
    const cutoff =
      Math.max(Date.parse(source.createdAt), Date.parse(source.lastSyncAt ?? source.createdAt)) -
      30 * 86400000;
    const oldPage =
      page.items.length > 0 &&
      page.items.every((item) => {
        const published =
          item.contentDetails.videoPublishedAt ?? dates.get(item.contentDetails.videoId);
        return !!published && Date.parse(published) < cutoff;
      });
    // This connector covers a rolling recent window, never a multi-day full-archive crawl.
    const capped = request.page >= 5 && !!page.nextPageToken;
    return {
      items: updates,
      hasNext: !!page.nextPageToken,
      nextCursor: page.nextPageToken,
      pageSize: page.items.length,
      historyComplete: oldPage || capped,
      windowCapped: capped,
    };
  }
  async materialize(update: SourceUpdate) {
    return update;
  }
}
