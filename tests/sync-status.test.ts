import { expect, it } from 'vitest';
import type { Job, Subscription } from '../src/shared/types';
import { getSubscriptionSyncStatus } from '../src/shared/sync-status';

const subscription = (patch: Partial<Subscription> = {}): Subscription => ({
  id: 'sub-1',
  externalId: 'repo-1',
  kind: 'repo',
  name: 'owner/repo',
  description: '',
  url: 'https://github.com/owner/repo',
  enabled: true,
  priority: false,
  demo: false,
  createdAt: '2026-09-18T00:00:00.000Z',
  lastSyncAt: null,
  error: null,
  coverage: 'pending',
  ...patch,
});

const job = (status: Job['status']): Job => ({
  id: 'job-1',
  kind: 'sync',
  targetId: 'sub-1',
  status,
  error: null,
  createdAt: '2026-09-18T00:00:00.000Z',
});

it.each([
  ['pending', 'waiting', '等待同步'],
  ['running', 'syncing', '正在同步'],
] as const)('maps an active queue job to %s', (status, expectedState, expectedLabel) => {
  expect(getSubscriptionSyncStatus(subscription(), [job(status)], true)).toMatchObject({
    state: expectedState,
    label: expectedLabel,
  });
});

it('distinguishes completed and partial coverage', () => {
  expect(
    getSubscriptionSyncStatus(
      subscription({ coverage: 'complete', lastSyncAt: '2026-09-18T01:00:00.000Z' }),
      [],
      true,
    ),
  ).toMatchObject({ state: 'completed', label: '已完成' });
  expect(getSubscriptionSyncStatus(subscription({ coverage: 'partial' }), [], true)).toMatchObject({
    state: 'partial',
    label: '部分完成',
  });
});

it('prioritizes pause, auth, rate limit, and worker offline states', () => {
  expect(getSubscriptionSyncStatus(subscription({ enabled: false }), [job('running')], false)).toMatchObject({
    state: 'paused',
    label: '已暂停',
  });
  expect(
    getSubscriptionSyncStatus(
      subscription({ error: 'GitHub 授权已失效，请重新连接。' }),
      [],
      true,
    ),
  ).toMatchObject({ state: 'auth_required', label: '需要重新连接' });
  expect(
    getSubscriptionSyncStatus(
      subscription({ retryAt: '2026-09-18T02:00:00.000Z', error: 'GitHub 暂时限制请求。' }),
      [],
      true,
      Date.parse('2026-09-18T01:00:00.000Z'),
    ),
  ).toMatchObject({ state: 'rate_limited', label: '等待限流结束' });
  expect(getSubscriptionSyncStatus(subscription(), [job('pending')], false)).toMatchObject({
    state: 'worker_offline',
    label: '后台服务离线',
  });
});

it('exposes ordinary sync failures without treating them as authorization failures', () => {
  expect(
    getSubscriptionSyncStatus(subscription({ error: '本轮同步未完成，稍后可重试。' }), [], true),
  ).toMatchObject({ state: 'failed', label: '同步失败', detail: '本轮同步未完成，稍后可重试。' });
});
