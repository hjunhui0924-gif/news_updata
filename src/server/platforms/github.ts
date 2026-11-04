import { GitHubConnector } from '../connectors/github';
import {
  PlatformError,
  type PlatformAdapter,
  type PageRequest,
  type SourceUpdate,
  type UpdatePage,
} from './contract';
import type { Subscription } from '@/shared/types';
import { platformCapabilities, type SourceKind } from '@/shared/platforms';

export class GitHubAdapter implements PlatformAdapter {
  readonly platform = 'github' as const;
  readonly kinds = platformCapabilities.github.kinds;
  constructor(private readonly connector: GitHubConnector) {}
  resolve(kind: SourceKind, input: string) {
    if (kind !== 'repo' && kind !== 'author')
      throw new PlatformError('GitHub 不支持这种来源类型。', 400);
    return this.connector.resolve(kind, input);
  }
  streams(source: Subscription) {
    return source.kind === 'author' ? ['repositories', 'author-releases'] : ['repositories'];
  }
  async readPage(source: Subscription, stream: string, request: PageRequest): Promise<UpdatePage> {
    if (source.kind !== 'repo' && source.kind !== 'author')
      throw new PlatformError('来源类型无效。', 400);
    let response =
      stream === 'author-releases'
        ? await this.connector.authorReleases(source.name, request.page, source.externalId)
        : await this.connector.updates(
            source.kind,
            source.name,
            request.page,
            source.kind === 'repo' ? request.validator?.etag : undefined,
          );
    if ('notModified' in response && response.notModified) {
      if (!request.validator) throw new PlatformError('同步缓存不可用，请重新同步。', 502);
      response = {
        ...response,
        hasNext: request.validator.hasNext || request.validator.pageSize >= 100,
      };
    }
    return {
      ...response,
      items: response.items.map(({ repo, ...update }) => ({ ...update, sourceName: repo })),
      etag: source.kind === 'repo' && 'etag' in response ? response.etag : undefined,
      pageSize: 'pageSize' in response ? response.pageSize : response.items.length,
      historyComplete:
        stream === 'repositories' &&
        source.kind === 'author' &&
        response.items.some(
          (update) =>
            Date.parse(update.publishedAt) <
            Date.parse(source.lastSyncAt ?? source.createdAt) - 30 * 86400000,
        ),
    };
  }
  async materialize(update: SourceUpdate): Promise<SourceUpdate> {
    if (update.type !== 'new_repo') return update;
    const body = await this.connector.readme(update.sourceName);
    return { ...update, body, contentUrl: body ? update.contentUrl : undefined };
  }
}
