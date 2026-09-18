import { z } from 'zod';
import { GitHubConnector, GitHubError, parseSourceInput } from '../connectors/github';
import { createUserGitHubConnector } from '../connectors/github-user';
import { getPool } from '../db/client';
import { getSubscriptions } from '../db/store';
import type { GitHubFollowingPreview } from '@/shared/types';
import type { Subscription } from '@/shared/types';
import { addSubscription } from './service';

type FollowingDependencies = {
  getSubscriptions?: typeof getSubscriptions;
  addSubscription?: typeof addSubscription;
  resolveUsername?: (userId: string, connector: GitHubConnector) => Promise<string>;
};

export const followingImportSchema = z
  .object({
    usernames: z
      .array(z.string().transform((value) => parseSourceInput(value, 'author')))
      .min(1)
      .max(50),
  })
  .strict();

export const followingPreviewSchema = z
  .object({
    username: z.string().trim().min(1).max(39).optional(),
    page: z.number().int().min(1).max(10000).default(1),
  })
  .strict();

export async function previewFollowing(
  userId: string,
  input: unknown,
  connector?: GitHubConnector,
  dependencies?: FollowingDependencies,
): Promise<GitHubFollowingPreview> {
  const { username, page } = followingPreviewSchema.parse(input);
  const github = connector ?? (await createUserGitHubConnector(userId));
  const resolveUsername =
    dependencies?.resolveUsername ?? (async (viewerId: string, currentConnector: GitHubConnector) => {
      const { rows } = await getPool().query(
        'SELECT "accountId" FROM account WHERE "userId"=$1 AND "providerId"=$2',
        [viewerId, 'github'],
      );
      if (!rows[0]) throw new GitHubError('请填写 GitHub 用户名，或先使用 GitHub 登录。', 400);
      return currentConnector.usernameById(rows[0].accountId);
    });
  const normalized = parseSourceInput(
    username || (await resolveUsername(userId, github)),
    'author',
  );
  const [result, subscriptions] = await Promise.all([
    github.following(normalized, page),
    (dependencies?.getSubscriptions ?? getSubscriptions)(userId),
  ]);
  const subscribed = new Set(
    subscriptions.filter((subscription) => subscription.kind === 'author').map((subscription) => subscription.externalId),
  );
  return {
    username: normalized,
    page: result.page,
    nextPage: result.nextPage,
    truncated: result.truncated,
    users: result.users.map((user) => ({ ...user, subscribed: subscribed.has(user.id) })),
  };
}

export async function importFollowing(
  userId: string,
  input: unknown,
  connector?: GitHubConnector,
  dependencies?: Pick<FollowingDependencies, 'addSubscription'>,
) {
  const { usernames } = followingImportSchema.parse(input);
  const github = connector ?? (await createUserGitHubConnector(userId));
  const names = usernames.filter(
    (name, index, values) =>
      values.findIndex((candidate) => candidate.toLowerCase() === name.toLowerCase()) === index,
  );
  const added: Subscription[] = [];
  const failed: { name: string; error: string }[] = [];
  const add = dependencies?.addSubscription ?? addSubscription;
  for (let offset = 0; offset < names.length; offset += 5) {
    const batch = names.slice(offset, offset + 5);
    const results = await Promise.allSettled(
      batch.map((name) => add(userId, 'author', name, github)),
    );
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') added.push(result.value);
      else
        failed.push({
          name: batch[index],
          error: result.reason instanceof GitHubError ? result.reason.message : '导入失败，请稍后重试。',
        });
    });
  }
  return { added, failed };
}
