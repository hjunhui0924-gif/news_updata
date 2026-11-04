import { YouTubeAdapter } from '../src/server/platforms/youtube';
import { PlatformError } from '../src/server/platforms/contract';

const input = process.argv.slice(2).filter((argument) => argument !== '--');
try {
  if (input.length !== 1)
    throw new PlatformError('用法：pnpm youtube:check -- "@频道名"（或频道 ID/地址）', 400);
  const adapter = new YouTubeAdapter();
  const resolved = await adapter.resolve('channel', input[0]);
  const page = await adapter.readPage(
    {
      ...resolved,
      id: 'read-only-check',
      platform: 'youtube',
      kind: 'channel',
      enabled: true,
      priority: false,
      demo: false,
      createdAt: new Date().toISOString(),
      lastSyncAt: null,
      error: null,
      coverage: 'pending',
    },
    'uploads',
    { page: 1 },
  );
  console.log(
    JSON.stringify(
      {
        platform: 'youtube',
        channel: resolved.name,
        externalId: resolved.externalId,
        publicVideosOnFirstPage: page.items.length,
        hasMore: page.hasNext,
        writesDatabase: false,
        content: 'metadata-and-description-only',
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    error instanceof PlatformError ? error.message : 'YouTube 检查失败；请检查配置和服务器网络。',
  );
  process.exitCode = 1;
}
