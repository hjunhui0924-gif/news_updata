import { it, expect } from 'vitest';
import { GitHubConnector, GitHubError } from '../src/server/connectors/github';
const repo = {
  id: 1,
  name: 'tool',
  full_name: 'owner/tool',
  description: 'Useful tool',
  html_url: 'https://github.com/owner/tool',
  created_at: '2026-01-01T00:00:00Z',
  fork: false,
  private: false,
  owner: { id: 2, login: 'owner' },
  stargazers_count: 100,
  language: 'TypeScript',
  updated_at: '2026-09-13T00:00:00Z',
  archived: false,
};
it('searches GitHub with encoded input, public restriction and explicit sorting', async () => {
  let path = '';
  const connector = new GitHubConnector(async (input) => {
    path = input;
    return {
      hasNext: true,
      data: {
        total_count: 40,
        incomplete_results: false,
        items: [repo, { ...repo, id: 3, private: true }],
      },
    };
  });
  const result = await connector.searchRepositories({
    query: 'agent & language:TypeScript',
    sort: 'stars',
  });
  const url = new URL(path, 'https://api.github.com');
  expect(url.pathname).toBe('/search/repositories');
  expect(url.searchParams.get('q')).toBe('agent & language:TypeScript is:public');
  expect(url.searchParams.get('sort')).toBe('stars');
  expect(result.repositories).toHaveLength(1);
  expect(result.repositories[0]).toMatchObject({
    name: 'owner/tool',
    stars: 100,
    language: 'TypeScript',
  });
  expect(result.nextPage).toBe(2);
});
it('caps the GitHub 1000-result window and keeps incomplete results explicit', async () => {
  const connector = new GitHubConnector(async () => ({
    hasNext: true,
    data: { total_count: 5000, incomplete_results: true, items: [] },
  }));
  expect(await connector.searchRepositories({ query: 'agent', page: 50 })).toMatchObject({
    nextPage: null,
    incomplete: true,
    totalCount: 5000,
  });
  for (const input of [
    { query: ' ' },
    { query: 'agent', page: 51 },
    { query: 'agent', sort: 'invalid' },
  ])
    await expect(connector.searchRepositories(input)).rejects.toThrow();
});
it('propagates API rate limits as errors instead of empty results', async () => {
  const connector = new GitHubConnector(async () => {
    throw new GitHubError('搜索限流', 429, 60);
  });
  await expect(connector.searchRepositories({ query: 'agent' })).rejects.toMatchObject({
    status: 429,
  });
});
