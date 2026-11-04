import type { FeedItem, Subscription } from './types';

export type PlatformId = 'github' | 'youtube';
export type SourceKind = 'repo' | 'author' | 'channel';
export const platformCapabilities: Readonly<
  Record<
    PlatformId,
    {
      label: string;
      kinds: readonly SourceKind[];
      body: 'markdown' | 'description';
      conditionalRequests: boolean;
    }
  >
> = {
  github: {
    label: 'GitHub',
    kinds: ['repo', 'author'],
    body: 'markdown',
    conditionalRequests: true,
  },
  youtube: {
    label: 'YouTube',
    kinds: ['channel'],
    body: 'description',
    conditionalRequests: false,
  },
};
export const platformLabels: Record<PlatformId, string> = {
  github: platformCapabilities.github.label,
  youtube: platformCapabilities.youtube.label,
};
export function supportsSourceKind(platform: PlatformId, kind: SourceKind) {
  return platformCapabilities[platform]?.kinds.includes(kind) ?? false;
}

// Missing platform is the persisted pre-adapter GitHub format, not an unknown provider.
export function sourcePlatform(source: { platform?: PlatformId }): PlatformId {
  return source.platform ?? 'github';
}

export function itemExternalKey(item: Pick<FeedItem, 'platform' | 'type' | 'externalId'>) {
  const local = `${item.type}:${item.externalId}`;
  return sourcePlatform(item) === 'github' ? local : `${sourcePlatform(item)}:${local}`;
}

export function subscriptionScope(source: Pick<Subscription, 'kind' | 'platform'>) {
  if (source.kind === 'channel') return '跟踪：频道公开新视频 · 简介与原视频入口';
  return source.kind === 'author'
    ? '跟踪：新建公开项目 · 本人发布的正式版本'
    : '跟踪：正式版本 · 已收录版本的说明变化';
}

export const itemTypeLabels = { release: '版本发布', new_repo: '新项目', video: '新视频' };
