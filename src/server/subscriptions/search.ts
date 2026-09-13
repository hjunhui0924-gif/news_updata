import { GitHubConnector, repositorySearchSchema } from '../connectors/github';
import { createUserGitHubConnector } from '../connectors/github-user';
import { getSubscriptions } from '../db/store';
import type { RepositorySearchResult } from '@/shared/types';
export async function searchRepositories(
  userId: string,
  input: unknown,
  connector?: GitHubConnector,
  signal?: AbortSignal,
): Promise<RepositorySearchResult> {
  const parsed = repositorySearchSchema.parse(input);
  connector ??= await createUserGitHubConnector(userId, signal);
  const [result, subscriptions] = await Promise.all([
    connector.searchRepositories(parsed),
    getSubscriptions(userId),
  ]);
  const subscribed = new Set(
    subscriptions.filter((sub) => sub.kind === 'repo').map((sub) => sub.externalId),
  );
  return {
    ...result,
    repositories: result.repositories.map((repo) => ({
      ...repo,
      subscribed: subscribed.has(repo.id),
    })),
  };
}
