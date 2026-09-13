import { createHash } from 'node:crypto';
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { z } from 'zod';
import { getConfig } from '../config';
import { getPool, transaction } from '../db/client';
import { GitHubError } from './github';
import type { GitHubAuthStatus } from '@/shared/types';

type Account = {
  id: string;
  accountId: string;
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
};
type Failure = {
  fingerprint: string;
  state: 'reconnect_required' | 'temporary_error' | 'configuration_error';
  retryAt: string | null;
};
const fingerprint = (account: Account) =>
  createHash('sha256')
    .update(account.accessToken ?? '')
    .digest('hex');
const stateKey = (userId: string) => `github-auth:${userId}`;
const expired = (date: Date | null, margin = 0) => !!date && date.getTime() <= Date.now() + margin;
const accountQuery =
  'SELECT id,"accountId","accessToken","refreshToken","accessTokenExpiresAt","refreshTokenExpiresAt" FROM account WHERE "userId"=$1 AND "providerId"=\'github\'';
const messages = {
  connected: 'GitHub 已连接，访问凭据将按需自动续期。',
  refresh_pending: '访问凭据即将到期或已到期，下次同步会自动续期。',
  reconnect_required: 'GitHub 授权已失效，请重新连接。订阅和阅读记录仍保留。',
  temporary_error: 'GitHub 连接暂时失败，稍后会自动重试，无需重新登录。',
  public: '使用公开访问，尚未连接 GitHub 账号。',
  configured: '使用服务端配置的访问凭据，其有效性将在请求时检查。',
  configuration_error: '服务端 GitHub 访问凭据已失效，请更新服务端配置，无需重新登录。',
};
// Credential failures must not turn off subscription preferences.
export class GitHubAuthError extends GitHubError {
  constructor(
    public state: Failure['state'],
    message = messages[state],
  ) {
    super(message, 503);
  }
}
function allowed(account: Account) {
  return getConfig()
    .ALLOWED_GITHUB_USER_IDS.split(',')
    .map((id) => id.trim())
    .includes(account.accountId);
}
export async function getGitHubAuthStatus(userId: string): Promise<GitHubAuthStatus> {
  const [accounts, states] = await Promise.all([
    getPool().query<Account>(accountQuery, [userId]),
    getPool().query('SELECT value FROM system_state WHERE key=$1', [stateKey(userId)]),
  ]);
  const account = accounts.rows[0];
  const failure: Failure | undefined = states.rows[0]?.value;
  const matching = !!account && failure?.fingerprint === fingerprint(account);
  let state: GitHubAuthStatus['state'];
  const configuredToken = getConfig().GITHUB_READ_TOKEN;
  if (configuredToken)
    state =
      failure?.fingerprint === createHash('sha256').update(configuredToken).digest('hex')
        ? 'configuration_error'
        : 'configured';
  else if (!account) state = 'public';
  else if (!account.accessToken || !allowed(account)) state = 'reconnect_required';
  else if (matching) state = failure!.state;
  else if (expired(account.accessTokenExpiresAt, 60000))
    state =
      account.refreshToken && !expired(account.refreshTokenExpiresAt)
        ? 'refresh_pending'
        : 'reconnect_required';
  else state = 'connected';
  return {
    state,
    message: messages[state],
    expiresAt: configuredToken ? null : (account?.accessTokenExpiresAt?.toISOString() ?? null),
    retryAt: !configuredToken && matching ? failure!.retryAt : null,
  };
}
const tokensSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive().max(31536000).optional(),
  refresh_token_expires_in: z.number().int().positive().max(31536000).optional(),
  scope: z.string().optional(),
});

export async function githubReadToken(
  userId: string,
  options: { signal?: AbortSignal; rejectedToken?: string } = {},
) {
  options.signal?.throwIfAborted();
  const config = getConfig();
  if (config.GITHUB_READ_TOKEN) return config.GITHUB_READ_TOKEN;
  const result = await transaction(
    async (client): Promise<{ token: string } | { error: GitHubAuthError }> => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [stateKey(userId)]);
      options.signal?.throwIfAborted();
      // Also serialize against OAuth callback updates during a new login.
      const account = (await client.query<Account>(`${accountQuery} FOR UPDATE`, [userId])).rows[0];
      if (!account) return { token: '' };
      const fail = async (state: Failure['state']) => {
        await client.query(
          'INSERT INTO system_state(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
          [
            stateKey(userId),
            {
              fingerprint: fingerprint(account),
              state,
              retryAt:
                state === 'temporary_error' ? new Date(Date.now() + 60000).toISOString() : null,
            },
          ],
        );
        return { error: new GitHubAuthError(state) };
      };
      if (!allowed(account))
        return {
          error: new GitHubAuthError('reconnect_required', '此 GitHub 账号已不在访问允许名单中。'),
        };
      if (!account.accessToken) return fail('reconnect_required');
      const failure: Failure | undefined = (
        await client.query('SELECT value FROM system_state WHERE key=$1', [stateKey(userId)])
      ).rows[0]?.value;
      if (
        failure?.fingerprint === fingerprint(account) &&
        (failure.state === 'reconnect_required' ||
          (failure.retryAt && Date.parse(failure.retryAt) > Date.now()))
      )
        return { error: new GitHubAuthError(failure.state) };
      let token: string;
      try {
        token = await symmetricDecrypt({
          key: config.BETTER_AUTH_SECRET,
          data: account.accessToken,
        });
      } catch {
        return fail('reconnect_required');
      }
      if (options.rejectedToken !== token && !expired(account.accessTokenExpiresAt, 60000))
        return { token };
      if (!account.refreshToken || expired(account.refreshTokenExpiresAt))
        return fail('reconnect_required');
      let refreshToken: string;
      try {
        refreshToken = await symmetricDecrypt({
          key: config.BETTER_AUTH_SECRET,
          data: account.refreshToken,
        });
      } catch {
        return fail('reconnect_required');
      }
      options.signal?.throwIfAborted();
      if (!config.GITHUB_CLIENT_ID || !config.GITHUB_CLIENT_SECRET) return fail('temporary_error');
      let tokens: z.infer<typeof tokensSchema>;
      try {
        // Finish a started rotation even if the caller cancels; persist replacements first.
        const response = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(20000),
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: config.GITHUB_CLIENT_ID,
            client_secret: config.GITHUB_CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
          }),
        });
        const data: unknown = await response.json();
        const error = z.object({ error: z.string() }).safeParse(data);
        if (
          error.success &&
          ['bad_refresh_token', 'invalid_grant', 'expired_token', 'invalid_refresh_token'].includes(
            error.data.error,
          )
        )
          return fail('reconnect_required');
        if (!response.ok || error.success) return fail('temporary_error');
        const parsed = tokensSchema.safeParse(data);
        if (!parsed.success) return fail('temporary_error');
        tokens = parsed.data;
      } catch {
        return fail('temporary_error');
      }
      const access = await symmetricEncrypt({
        key: config.BETTER_AUTH_SECRET,
        data: tokens.access_token,
      });
      const refresh = tokens.refresh_token
        ? await symmetricEncrypt({ key: config.BETTER_AUTH_SECRET, data: tokens.refresh_token })
        : account.refreshToken;
      await client.query(
        'UPDATE account SET "accessToken"=$2,"refreshToken"=$3,"accessTokenExpiresAt"=$4,"refreshTokenExpiresAt"=$5,scope=coalesce($6,scope),"updatedAt"=now() WHERE id=$1',
        [
          account.id,
          access,
          refresh,
          tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
          tokens.refresh_token_expires_in
            ? new Date(Date.now() + tokens.refresh_token_expires_in * 1000)
            : account.refreshTokenExpiresAt,
          tokens.scope ?? null,
        ],
      );
      await client.query('DELETE FROM system_state WHERE key=$1', [stateKey(userId)]);
      return { token: tokens.access_token };
    },
  );
  options.signal?.throwIfAborted();
  if ('error' in result) throw result.error;
  return result.token;
}

export async function markGitHubRejected(userId: string, token: string) {
  if (getConfig().GITHUB_READ_TOKEN) {
    await getPool().query(
      'INSERT INTO system_state(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      [
        stateKey(userId),
        {
          fingerprint: createHash('sha256').update(token).digest('hex'),
          state: 'configuration_error',
          retryAt: null,
        },
      ],
    );
    return;
  }
  await transaction(async (client) => {
    const account = (await client.query<Account>(`${accountQuery} FOR UPDATE`, [userId])).rows[0];
    if (!account?.accessToken) return;
    const current = await symmetricDecrypt({
      key: getConfig().BETTER_AUTH_SECRET,
      data: account.accessToken,
    });
    if (current !== token) return; // Late 401s cannot invalidate a newer login.
    await client.query(
      'INSERT INTO system_state(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      [
        stateKey(userId),
        { fingerprint: fingerprint(account), state: 'reconnect_required', retryAt: null },
      ],
    );
  });
}
