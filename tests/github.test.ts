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
