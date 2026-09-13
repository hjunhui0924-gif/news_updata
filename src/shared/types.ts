export type ItemType = 'release' | 'new_repo';
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
  id: string;
  sourceId: string;
  externalId: string;
  type: ItemType;
  repo: string;
  author: string;
  title: string;
  description: string;
  url: string;
  publishedAt: string;
  firstSeenAt: string;
  body: string;
  contentHash: string;
  language: 'en' | 'zh';
  tags: string[];
  color: string;
  demo: boolean;
  backfill: boolean;
  summary: Summary | null;
  aiStatus: AiStatus;
  aiError?: string;
  translation: string | null;
  read: boolean;
  saved: boolean;
  muted: boolean;
  priority: boolean;
};
export type Subscription = {
  id: string;
  externalId: string;
  kind: 'repo' | 'author';
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
};
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
export type StarSyncStatus = {
  enabled: boolean;
  nextSyncAt: string;
  lastSyncAt: string | null;
  lastAdded: number;
  nextPage: number;
  error: string | null;
  intervalMinutes: number;
};
export type JobKind = 'sync' | 'stars' | 'summary' | 'translation' | 'digest';
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
export type Bootstrap = {
  mode: 'demo' | 'live';
  user: { name: string; image?: string | null };
  items: FeedItem[];
  subscriptions: Subscription[];
  preferences: Preferences;
  notifications: Notification[];
  jobs: Job[];
  starSync: StarSyncStatus | null;
  services: {
    github: boolean;
    ai: boolean;
    workerLastSeen: string | null;
    workerOnline: boolean;
    costToday: number;
  };
};
