import { symmetricDecrypt } from 'better-auth/crypto';
import { getConfig } from '../config';
import { getPool } from '../db/client';
import { GitHubConnector, GitHubError, createGitHubTransport } from './github';

export async function githubReadToken(userId: string) {
  const config = getConfig();
  if (config.GITHUB_READ_TOKEN) return config.GITHUB_READ_TOKEN;
  const { rows } = await getPool().query(
    'SELECT "accountId","accessToken","accessTokenExpiresAt" FROM account WHERE "userId"=$1 AND "providerId"=$2',
    [userId, 'github'],
  );
  const account = rows[0];
  if (!account?.accessToken) return '';
  if (
    !config.ALLOWED_GITHUB_USER_IDS.split(',')
      .map((id) => id.trim())
      .includes(account.accountId)
  )
    throw new GitHubError('此 GitHub 账号已不在访问允许名单中。', 401);
  if (
    account.accessTokenExpiresAt &&
    new Date(account.accessTokenExpiresAt).getTime() <= Date.now()
  )
    throw new GitHubError('GitHub 授权已过期，请重新登录。', 401);
  try {
    // Same public crypto API used by Better Auth's encryptOAuthTokens option.
    return await symmetricDecrypt({ key: config.BETTER_AUTH_SECRET, data: account.accessToken });
  } catch {
    throw new GitHubError('GitHub 授权无法读取，请重新登录。', 401);
  }
}
export async function createUserGitHubConnector(userId: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  return new GitHubConnector(createGitHubTransport(signal, await githubReadToken(userId)));
}
