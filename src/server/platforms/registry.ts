import type { Subscription } from '@/shared/types';
import { sourcePlatform, type PlatformId, type SourceKind } from '@/shared/platforms';
import { getConfig } from '../config';
import { createUserGitHubConnector } from '../connectors/github-user';
import { GitHubAdapter } from './github';
import { YouTubeAdapter } from './youtube';
import { createUserYouTubeTransport } from './youtube-auth';
import { PlatformError, type PlatformAdapter } from './contract';

export function assertSourceKind(platform: PlatformId, kind: SourceKind) {
  const supported = platform === 'github' ? ['repo', 'author'] : ['channel'];
  if (!supported.includes(kind)) throw new PlatformError('该平台不支持这种订阅类型。', 400);
}

export async function createPlatformAdapter(
  userId: string,
  platform: PlatformId,
  signal?: AbortSignal,
): Promise<PlatformAdapter> {
  if (platform === 'github')
    return new GitHubAdapter(await createUserGitHubConnector(userId, signal));
  if (platform === 'youtube')
    return new YouTubeAdapter(await createUserYouTubeTransport(userId, signal));
  throw new PlatformError('该平台的连接器尚未启用。', 503);
}

export function syncIntervalMinutes(source: Subscription) {
  const config = getConfig();
  if (sourcePlatform(source) === 'youtube') return config.SYNC_YOUTUBE_INTERVAL_MINUTES;
  return source.kind === 'repo'
    ? config.SYNC_REPO_INTERVAL_MINUTES
    : config.SYNC_AUTHOR_INTERVAL_MINUTES;
}
