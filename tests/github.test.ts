import { describe, it, expect } from 'vitest';
import { GitHubConnector, parseSourceInput } from '../src/server/connectors/github';
const release = (id: number, prerelease = false) => ({
  id,
  name: `Release ${id}`,
  tag_name: `v${id}`,
  body: 'Changes',
  html_url: `https://github.com/example/repo/releases/tag/v${id}`,
  published_at: '2026-09-13T00:00:00Z',
  created_at: '2026-09-13T00:00:00Z',
  draft: false,
  prerelease,
});
describe('GitHub connector', () => {
  it('pages starred repositories, includes forks and excludes private entries', async () => {
    const repo = (id: number, extra = {}) => ({
      id,
      name: 'repo',
      full_name: `owner/repo-${id}`,
      description: null,
      html_url: `https://github.com/owner/repo-${id}`,
      created_at: '2026-09-13T00:00:00Z',
      fork: false,
      private: false,
      owner: { id: 1, login: 'owner' },
      ...extra,
    });
    const paths: string[] = [];
    const connector = new GitHubConnector(async (path) => {
      paths.push(path);
      return {
        hasNext: true,
        data: [repo(1), repo(1), repo(2, { fork: true }), repo(3, { private: true })],
      };
    });
    const result = await connector.starred('example', 2);
    expect(paths).toEqual([
      '/users/example/starred?sort=created&direction=desc&per_page=50&page=2',
    ]);
    expect(result.repositories.map((repo) => repo.id)).toEqual(['1', '2']);
    expect(result.nextPage).toBe(3);
    await expect(connector.starred('example', 0)).rejects.toThrow('分页');
    await expect(connector.starred('https://evil.test', 1)).rejects.toThrow();
    expect(paths).toHaveLength(1);
  });
  it('pages following users with an explicit page contract', async () => {
    const paths: string[] = [];
    const connector = new GitHubConnector(async (path) => {
      paths.push(path);
      return {
        hasNext: true,
        data: [
          { id: 10, login: 'alice', type: 'User' },
          { id: 11, login: 'bob', type: 'User' },
        ],
      };
    });
    await expect(connector.following('example', 2)).resolves.toEqual({
      users: [
        { id: '10', login: 'alice' },
        { id: '11', login: 'bob' },
      ],
      page: 2,
      nextPage: 3,
      truncated: true,
    });
    expect(paths).toEqual(['/users/example/following?per_page=50&page=2']);
    await expect(connector.following('example', 0)).rejects.toThrow('分页');
  });
  it('resolves the current account by stable GitHub ID and preserves starred API errors', async () => {
    const connector = new GitHubConnector(async (path) => {
      expect(path).toBe('/user/123');
      return { hasNext: false, data: { id: 123, login: 'renamed-user' } };
    });
    expect(await connector.usernameById('123')).toBe('renamed-user');
    await expect(connector.usernameById('../user')).rejects.toThrow('ID');
    const { GitHubError } = await import('../src/server/connectors/github');
    await expect(
      new GitHubConnector(async () => {
        throw new GitHubError('limited', 429);
      }).starred('example'),
    ).rejects.toThrow('limited');
  });
  it('allows only public GitHub-shaped inputs, never arbitrary fetch targets', () => {
    expect(parseSourceInput('https://github.com/vercel/next.js/', 'repo')).toBe('vercel/next.js');
    for (const input of [
      'http://127.0.0.1',
      'https://github.com.evil.test/a/b',
      'a/../b',
      'a/b?token=secret',
      'https://github.com:443/a/b#x',
    ])
      expect(() => parseSourceInput(input, 'repo')).toThrow();
  });
  it('filters prereleases and drafts without losing pagination state', async () => {
    const connector = new GitHubConnector(async () => ({
      data: [release(1), release(2, true), { ...release(3), draft: true }],
      hasNext: true,
    }));
    const page = await connector.updates('repo', 'example/repo', 1);
    expect(page.items.map((x) => x.externalId)).toEqual(['1']);
    expect(page.hasNext).toBe(true);
  });
  it('keeps the README source path for discovered repositories', async () => {
    const connector = new GitHubConnector(async () => ({
      data: [
        {
          id: 77,
          name: 'tool',
          full_name: 'alice/tool',
          description: 'A tool',
          html_url: 'https://github.com/alice/tool',
          created_at: '2026-09-13T00:00:00Z',
          fork: false,
          private: false,
          owner: { id: 42, login: 'alice' },
        },
      ],
      hasNext: false,
    }));
    await expect(connector.updates('author', 'alice', 1)).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          repo: 'alice/tool',
          contentUrl: 'https://github.com/alice/tool/blob/HEAD/README.md',
        }),
      ],
    });
  });
  it('returns an empty README for a repository without one but keeps network failures visible', async () => {
    const { GitHubError } = await import('../src/server/connectors/github');
    expect(
      await new GitHubConnector(async () => {
        throw new GitHubError('missing', 404);
      }).readme('a/b'),
    ).toBe('');
    await expect(
      new GitHubConnector(async () => {
        throw new GitHubError('limited', 429);
      }).readme('a/b'),
    ).rejects.toThrow('limited');
  });
});

describe('followed author releases', () => {
  const repo = {
    id: 77,
    name: 'tool',
    full_name: 'organization/tool',
    description: null,
    html_url: 'https://github.com/organization/tool',
    created_at: '2026-09-13T00:00:00Z',
    fork: false,
    private: false,
    owner: { id: 99, login: 'organization' },
  };
  const event = (releaseId: number, extra = {}) => ({
    type: 'ReleaseEvent',
    public: true,
    actor: { id: 42, login: 'alice' },
    repo: { name: 'organization/tool' },
    payload: { action: 'published', release: { id: releaseId } },
    ...extra,
  });
  it('uses actual actor identity across organization repos, fetches current notes, and excludes unrelated activity', async () => {
    const paths: string[] = [];
    const connector = new GitHubConnector(async (path) => {
      paths.push(path);
      if (path.includes('/events/public'))
        return {
          hasNext: true,
          data: [
            event(1),
            event(1),
            event(2),
            event(3),
            event(4, { actor: { id: 55, login: 'someone-else' } }),
            event(5, { public: false }),
            { type: 'PushEvent' },
          ],
        };
      if (path === '/repos/organization/tool') return { hasNext: false, data: repo };
      const n = Number(path.split('/').pop());
      return {
        hasNext: false,
        data: {
          ...release(n, n === 2),
          draft: n === 3,
          body: 'Current notes',
          updated_at: '2026-09-13T01:00:00Z',
          author: { id: 88, login: 'draft-creator' },
        },
      };
    });
    const result = await connector.authorReleases('alice', 1, '42');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      externalId: '1',
      repo: 'organization/tool',
      body: 'Current notes',
      author: 'draft-creator',
    });
    expect(paths).toEqual([
      '/users/alice/events/public?per_page=100&page=1',
      '/repos/organization/tool',
      '/repos/organization/tool/releases/1',
      '/repos/organization/tool/releases/2',
      '/repos/organization/tool/releases/3',
    ]);
    expect(result.hasNext).toBe(true);
  });
  it('does not reveal newly private repos and skips deleted releases, while surfacing rate limits', async () => {
    const { GitHubError } = await import('../src/server/connectors/github');
    let state: 'private' | 'deleted' | 'limited' = 'private';
    const connector = new GitHubConnector(async (path) => {
      if (path.includes('/events/public')) return { hasNext: false, data: [event(1)] };
      if (path === '/repos/organization/tool')
        return { hasNext: false, data: { ...repo, private: state === 'private' } };
      throw new GitHubError(state, state === 'deleted' ? 404 : 429);
    });
    expect((await connector.authorReleases('alice', 1, '42')).items).toEqual([]);
    state = 'deleted';
    expect((await connector.authorReleases('alice', 1, '42')).items).toEqual([]);
    state = 'limited';
    await expect(connector.authorReleases('alice', 1, '42')).rejects.toThrow('limited');
  });
  it('bounds the event window and rejects unsafe page or repository input', async () => {
    const connector = new GitHubConnector(async () => ({
      hasNext: true,
      data: Array.from({ length: 100 }, () => ({ type: 'PushEvent' })),
    }));
    expect(await connector.authorReleases('alice', 3, '42')).toMatchObject({
      hasNext: false,
      windowCapped: true,
    });
    await expect(connector.authorReleases('alice', 4, '42')).rejects.toThrow('300');
    await expect(
      new GitHubConnector(async () => ({
        hasNext: false,
        data: [event(1, { repo: { name: 'https://evil.test' } })],
      })).authorReleases('alice', 1, '42'),
    ).rejects.toThrow();
  });
});
