import type { Job, Subscription } from './types';

export type SubscriptionSyncState =
  | 'paused'
  | 'waiting'
  | 'syncing'
  | 'completed'
  | 'partial'
  | 'rate_limited'
  | 'auth_required'
  | 'failed'
  | 'worker_offline';

export type SubscriptionSyncStatus = {
  state: SubscriptionSyncState;
  label: string;
  detail: string | null;
  retryAt: string | null;
};

type SyncJob = Pick<Job, 'kind' | 'targetId' | 'status'>;
type SyncSubscription = Pick<
  Subscription,
  'id' | 'enabled' | 'coverage' | 'lastSyncAt' | 'error' | 'retryAt'
>;

function isAuthError(message: string | null) {
  return !!message && /授权|重新连接|凭据|允许名单/.test(message);
}

export function getSubscriptionSyncStatus(
  subscription: SyncSubscription,
  jobs: SyncJob[],
  workerOnline: boolean,
  now = Date.now(),
): SubscriptionSyncStatus {
  if (!subscription.enabled) {
    return { state: 'paused', label: '已暂停', detail: null, retryAt: null };
  }
  if (isAuthError(subscription.error)) {
    return {
      state: 'auth_required',
      label: '需要重新连接',
      detail: subscription.error,
      retryAt: null,
    };
  }
  if (subscription.retryAt && Date.parse(subscription.retryAt) > now) {
    return {
      state: 'rate_limited',
      label: '等待限流结束',
      detail: subscription.error,
      retryAt: subscription.retryAt,
    };
  }

  const activeJob = jobs.find(
    (job) => job.kind === 'sync' && job.targetId === subscription.id && ['pending', 'running'].includes(job.status),
  );
  if (activeJob && !workerOnline) {
    return {
      state: 'worker_offline',
      label: '后台服务离线',
      detail: '后台同步服务未连接，恢复后会继续检查。',
      retryAt: null,
    };
  }
  if (activeJob?.status === 'running') {
    return { state: 'syncing', label: '正在同步', detail: null, retryAt: null };
  }
  if (activeJob?.status === 'pending') {
    return { state: 'waiting', label: '等待同步', detail: null, retryAt: null };
  }
  if (subscription.error) {
    return {
      state: 'failed',
      label: '同步失败',
      detail: subscription.error,
      retryAt: null,
    };
  }
  if (subscription.coverage === 'partial') {
    return { state: 'partial', label: '部分完成', detail: '还有内容待补查。', retryAt: null };
  }
  if (subscription.coverage === 'complete' && subscription.lastSyncAt) {
    return { state: 'completed', label: '已完成', detail: null, retryAt: null };
  }
  return { state: 'waiting', label: '等待首次同步', detail: null, retryAt: null };
}
