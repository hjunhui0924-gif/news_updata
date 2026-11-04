import type { PlatformId, SourceKind } from './platforms';

export type ItemType = 'release' | 'new_repo' | 'video';
export type TranslationBlock = { original: string; translation: string | null };
export type AiStatus = 'ready' | 'pending' | 'disabled' | 'failed' | 'insufficient';
export type Summary = {
  headline: string;
  overview: string;
  changes: { text: string; evidenceIds: string[] }[];
  impact: { text: string; kind: 'stated' | 'inferred' | 'unknown' };
  breakingChange: 'yes' | 'no' | 'unknown';
  migrationNote: string | null;
  evidence: { id: string; text: string }[];
};
export type FeedItem = {
  platform?: PlatformId;
  id: string;
  sourceId: string;
  sourceIds?: string[];
  matchedSources?: { id: string; kind: SourceKind; name: string }[];
  externalId: string;
  type: ItemType;
  repo: string;
  sourceName?: string;
  author: string;
  title: string;
  description: string;
  url: string;
  contentUrl?: string;
  media?: { kind: 'video'; thumbnailUrl?: string; content: 'description' };
  publishedAt: string;
  firstSeenAt: string;
  body: string;
  contentHash: string;
  sourceUpdatedAt?: string;
  language: 'en' | 'zh';
  tags: string[];
  color: string;
  demo: boolean;
  backfill: boolean;
  summary: Summary | null;
  aiStatus: AiStatus;
  aiError?: string;
  translation: string | null;
  translationBlocks?: TranslationBlock[] | null;
  read: boolean;
  saved: boolean;
  muted: boolean;
  priority: boolean;
};
export type Subscription = {
  platform?: PlatformId;
  adapterData?: Record<string, string>;
  id: string;
  externalId: string;
  kind: SourceKind;
  name: string;
  description: string;
  url: string;
  enabled: boolean;
  priority: boolean;
  demo: boolean;
  createdAt: string;
  lastSyncAt: string | null;
  error: string | null;
  coverage: 'complete' | 'partial' | 'pending';
  retryAt?: string | null;
  autoFromStar?: boolean;
  authorEventWindowCapped?: boolean;
  syncWindowCapped?: boolean;
  syncProgress?: {
    stream: string;
    page: number;
    nextPage: number | null;
  };
};
export type FeedPreview = Omit<
  FeedItem,
  'body' | 'contentHash' | 'translation' | 'translationBlocks' | 'summary' | 'aiError'
> & { summary: Pick<Summary, 'overview'> | null };
export type Preferences = {
  timezone: string;
  compact: boolean;
};
export type StarredRepository = {
  id: string;
  name: string;
  description: string;
  url: string;
  subscribed: boolean;
};
export type StarredPreview = {
  username: string;
  repositories: StarredRepository[];
  nextPage: number | null;
};
export type GitHubFollowingUser = { login: string; id: string; subscribed: boolean };
export type GitHubFollowingPreview = {
  username: string;
  users: GitHubFollowingUser[];
  page: number;
  nextPage: number | null;
  truncated: boolean;
};
export type RepositorySearchResult = {
  query: string;
  page: number;
  totalCount: number;
  incomplete: boolean;
  nextPage: number | null;
  repositories: (StarredRepository & {
    stars: number;
    language: string | null;
    updatedAt: string;
    archived: boolean;
  })[];
};
export type StarSyncStatus = {
  enabled: boolean;
  nextSyncAt: string;
  lastSyncAt: string | null;
  lastAdded: number;
  nextPage: number;
  error: string | null;
  intervalMinutes: number;
};
export type JobKind =
  'sync' | 'stars' | 'summary' | 'translation' | 'skill-summary' | 'skill-translation' | 'digest';
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';
export type Job = {
  id: string;
  kind: JobKind;
  targetId: string;
  status: JobStatus;
  error: string | null;
  createdAt: string;
};
export type Notification = {
  id: string;
  subject: string;
  body: string;
  itemIds: string[];
  status: 'preview';
  createdAt: string;
  error: string | null;
};
export type GitHubAuthStatus = {
  state:
    | 'connected'
    | 'refresh_pending'
    | 'reconnect_required'
    | 'temporary_error'
    | 'configuration_error'
    | 'public'
    | 'configured';
  message: string;
  expiresAt: string | null;
  retryAt: string | null;
};
export type Bootstrap = {
  mode: 'demo' | 'live';
  user: { name: string; image?: string | null };
  items: FeedPreview[];
  selectedItem?: FeedItem;
  subscriptions: Subscription[];
  preferences: Preferences;
  notifications: Notification[];
  jobs: Job[];
  starSync: StarSyncStatus | null;
  services: {
    platforms?: Partial<Record<PlatformId, { configured: boolean; intervalMinutes: number }>>;
    githubAuth?: GitHubAuthStatus;
    github: boolean;
    ai: boolean;
    workerLastSeen: string | null;
    workerOnline: boolean;
    costToday: number;
  };
  feed?: Omit<FeedPage, 'items'>;
};
export type FeedPage = {
  matchingUnread?: number;
  all?: number;
  items: FeedPreview[];
  total: number;
  unread: number;
  saved: number;
  nextCursor: string | null;
};
