import type { FeedItem, Subscription } from '@/shared/types';
import type { PlatformId, SourceKind } from '@/shared/platforms';

export class PlatformError extends Error {
  constructor(
    message: string,
    public status = 502,
    public retryAfter = 60,
  ) {
    super(message);
    this.name = 'PlatformError';
  }
}

export class CursorExpiredError extends PlatformError {
  constructor() {
    super('来源分页位置已失效，将从首页重新检查。', 409);
  }
}

export type ResolvedSource = Pick<
  Subscription,
  'externalId' | 'name' | 'description' | 'url' | 'adapterData'
>;
export type SourceUpdate = Pick<
  FeedItem,
  | 'externalId'
  | 'type'
  | 'author'
  | 'title'
  | 'body'
  | 'description'
  | 'url'
  | 'contentUrl'
  | 'publishedAt'
  | 'sourceUpdatedAt'
  | 'media'
> & { sourceName: string };
export type PageValidator = {
  etag: string;
  hasNext: boolean;
  pageSize: number;
  historyIncrement: number;
  nextCursor?: string;
};
export type PageRequest = {
  page: number;
  cursor?: string;
  validator?: PageValidator;
};
export type UpdatePage = {
  items: SourceUpdate[];
  hasNext: boolean;
  nextCursor?: string;
  pageSize: number;
  etag?: string;
  notModified?: boolean;
  historyComplete?: boolean;
  windowCapped?: boolean;
};

// Only normalized content and checkpoint data cross this interface, never credentials or database handles.
export interface PlatformAdapter {
  readonly platform: PlatformId;
  readonly kinds: readonly SourceKind[];
  resolve(kind: SourceKind, input: string): Promise<ResolvedSource>;
  streams(source: Subscription): readonly string[];
  readPage(source: Subscription, stream: string, request: PageRequest): Promise<UpdatePage>;
  materialize(update: SourceUpdate): Promise<SourceUpdate>;
}
