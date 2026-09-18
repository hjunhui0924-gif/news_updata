import { expect, it } from 'vitest';
import { GitHubConnector } from '../src/server/connectors/github';
import { GitHubError } from '../src/server/connectors/github';
import { importFollowing, previewFollowing } from '../src/server/subscriptions/following';
import type { Subscription } from '../src/shared/types';

it('returns the requested following page and the next page contract', async () => {
  const paths: string[] = [];
  const connector = new GitHubConnector(async (path) => {
    paths.push(path);
    return {
      hasNext: true,
      data: [{ id: 10, login: 'alice', type: 'User' }],
    };
  });

  await expect(
    previewFollowing('user-1', { username: ' alice ', page: 2 }, connector, {
      getSubscriptions: async () => [
        { kind: 'author', externalId: '10' },
      ] as never,
    }),
  ).resolves.toEqual({
    username: 'alice',
    users: [{ id: '10', login: 'alice', subscribed: true }],
    page: 2,
    nextPage: 3,
    truncated: true,
  });
  expect(paths).toEqual(['/users/alice/following?per_page=50&page=2']);
});

it('can use the signed-in account when no manual following username is supplied', async () => {
  const connector = new GitHubConnector(async (path) => {
    expect(path).toBe('/users/alice/following?per_page=50&page=1');
    return { data: [{ id: 10, login: 'bob', type: 'User' }], hasNext: false };
  });
  await expect(
    previewFollowing('user-1', {}, connector, {
      resolveUsername: async () => 'alice',
      getSubscriptions: async () => [] as never,
    }),
  ).resolves.toMatchObject({
    username: 'alice',
    users: [{ id: '10', login: 'bob', subscribed: false }],
  });
});

it('imports following users with deduplication and structured failures', async () => {
  const connector = new GitHubConnector(async () => ({ data: [], hasNext: false }));
  const added = (name: string) => ({
    id: name,
    externalId: name,
    kind: 'author' as const,
    name,
    description: '',
    url: `https://github.com/${name}`,
    enabled: true,
    priority: false,
    demo: false,
    createdAt: new Date().toISOString(),
    lastSyncAt: null,
    error: null,
    coverage: 'pending' as const,
  });
  await expect(
    importFollowing(
      'user-1',
      { usernames: ['alice', 'ALICE', 'bob', 'missing'] },
      connector,
      {
        addSubscription: async (_userId, _kind, name) => {
          if (name === 'missing') throw new GitHubError('账号不存在', 404);
          return added(name) as Subscription;
        },
      },
    ),
  ).resolves.toMatchObject({
    added: [expect.objectContaining({ name: 'alice' }), expect.objectContaining({ name: 'bob' })],
    failed: [{ name: 'missing', error: '账号不存在' }],
  });
});
