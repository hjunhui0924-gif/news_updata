import { z } from 'zod';
import { GitHubConnector, GitHubError, parseSourceInput } from '../connectors/github';
import { getPool } from '../db/client';
import { getSubscriptions } from '../db/store';
import { addSubscription } from './service';
import { createUserGitHubConnector } from '../connectors/github-user';
import type { StarredPreview, Subscription } from '@/shared/types';

export const starredPreviewSchema = z
  .object({
    username: z.string().trim().max(200).optional(),
    page: z.number().int().min(1).max(10000).default(1),
  })
  .strict();
export const starredImportSchema = z
  .object({
    repositories: z
      .array(z.string().transform((value) => parseSourceInput(value, 'repo')))
      .min(1)
      .max(20),
  })
  .strict();

export async function previewStarred(
  userId: string,
  input: unknown,
  connector?: GitHubConnector,
): Promise<StarredPreview> {
  const { username, page } = starredPreviewSchema.parse(input);
  connector ??= await createUserGitHubConnector(userId);
  let login = username ? parseSourceInput(username, 'author') : '';
  if (!login) {
    const { rows } = await getPool().query(
      'SELECT "accountId" FROM account WHERE "userId"=$1 AND "providerId"=$2',
      [userId, 'github'],
    );
    if (!rows[0]) throw new GitHubError('请填写 GitHub 用户名，或先使用 GitHub 登录。', 400);
    login = await connector.usernameById(rows[0].accountId);
  }
  const [result, subscriptions] = await Promise.all([
    connector.starred(login, page),
    getSubscriptions(userId),
  ]);
  const subscribed = new Set(
    subscriptions.filter((sub) => sub.kind === 'repo').map((sub) => sub.externalId),
  );
  return {
    username: login,
    nextPage: result.nextPage,
    repositories: result.repositories.map((repo) => ({
      ...repo,
      subscribed: subscribed.has(repo.id),
    })),
  };
}

export async function importStarred(userId: string, input: unknown, connector?: GitHubConnector) {
  const { repositories } = starredImportSchema.parse(input);
  const github = connector ?? (await createUserGitHubConnector(userId));
  const names = [...new Map(repositories.map((name) => [name.toLowerCase(), name])).values()];
  const added: Subscription[] = [];
  const failed: { name: string; error: string }[] = [];
  // Bound GitHub concurrency, while the subscription service serializes quota/dedup writes.
  for (let offset = 0; offset < names.length; offset += 5) {
    const batch = names.slice(offset, offset + 5);
    const results = await Promise.allSettled(
      batch.map((name) => addSubscription(userId, 'repo', name, github)),
    );
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') added.push(result.value);
      else
        failed.push({
          name: batch[index],
          error:
            result.reason instanceof GitHubError ? result.reason.message : '导入失败，请稍后重试。',
        });
    });
  }
  return { added, failed };
}
