import { beforeAll, beforeEach, afterEach, afterAll, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { symmetricEncrypt, symmetricDecrypt } from 'better-auth/crypto';
import { getPool } from '../../src/server/db/client';
import { migrate } from '../../scripts/migrate';
import {
  githubReadToken,
  getGitHubAuthStatus,
  markGitHubRejected,
} from '../../src/server/connectors/github-auth';
import { setStarSync, syncStarred, getStarSync } from '../../src/server/subscriptions/star-sync';
const secret = 'test-secret-only-32-characters-long';
let userId: string;
let refresh: ReturnType<typeof vi.fn<typeof fetch>>;
beforeAll(async () => {
  await migrate();
});
beforeEach(async () => {
  for (const [key, value] of Object.entries({
    APP_MODE: 'live',
    GITHUB_READ_TOKEN: '',
    ALLOWED_GITHUB_USER_IDS: '123',
    BETTER_AUTH_SECRET: secret,
    GITHUB_CLIENT_ID: 'test-client',
    GITHUB_CLIENT_SECRET: 'test-client-secret',
  }))
    vi.stubEnv(key, value);
  userId = `auth-${randomUUID()}`;
  await getPool().query('INSERT INTO app_users(id,name) VALUES($1,$1)', [userId]);
  await getPool().query(
    'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',
    [userId, `${userId}@example.test`],
  );
  await getPool().query(
    'INSERT INTO account(id,"userId","providerId","accountId","accessToken","refreshToken","accessTokenExpiresAt","refreshTokenExpiresAt","createdAt","updatedAt") VALUES($1,$1,\'github\',\'123\',$2,$3,now()-interval \'1 minute\',now()+interval \'1 day\',now(),now())',
    [userId, await encrypt('old-access'), await encrypt('old-refresh')],
  );
  refresh = vi.fn<typeof fetch>(async () =>
    Response.json({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: 28800,
      refresh_token_expires_in: 15552000,
    }),
  );
  vi.stubGlobal('fetch', refresh);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await getPool().query('DELETE FROM system_state WHERE key=$1', [`github-auth:${userId}`]);
  await getPool().query('DELETE FROM "user" WHERE id=$1', [userId]);
  await getPool().query('DELETE FROM star_sync WHERE user_id=$1', [userId]);
  await getPool().query('DELETE FROM app_users WHERE id=$1', [userId]);
});
afterAll(async () => {
  await getPool().end();
});
const encrypt = (data: string) => symmetricEncrypt({ key: secret, data });
const account = async () =>
  (await getPool().query('SELECT * FROM account WHERE id=$1', [userId])).rows[0];
it('refreshes once across concurrent callers and stores both tokens encrypted', async () => {
  expect((await getGitHubAuthStatus(userId)).state).toBe('refresh_pending');
  expect(await Promise.all(Array.from({ length: 5 }, () => githubReadToken(userId)))).toEqual(
    Array(5).fill('new-access'),
  );
  expect(refresh).toHaveBeenCalledTimes(1);
  const [url, options] = refresh.mock.calls[0];
  expect(url).toBe('https://github.com/login/oauth/access_token');
  expect(String(options?.body)).toContain('grant_type=refresh_token');
  const row = await account();
  expect(row.accessToken).not.toContain('new-access');
  expect(await symmetricDecrypt({ key: secret, data: row.refreshToken })).toBe('new-refresh');
  expect((await getGitHubAuthStatus(userId)).state).toBe('connected');
});
it('does not refresh an unexpired or nonexpiring token', async () => {
  await getPool().query('UPDATE account SET "accessTokenExpiresAt"=null WHERE id=$1', [userId]);
  expect(await githubReadToken(userId)).toBe('old-access');
  expect(refresh).not.toHaveBeenCalled();
});
it('transient failures retain credentials, back off, then recover', async () => {
  refresh.mockRejectedValueOnce(new Error('upstream secret must not escape'));
  await expect(githubReadToken(userId)).rejects.toThrow('稍后会自动重试');
  await expect(githubReadToken(userId)).rejects.toThrow('稍后会自动重试');
  expect(refresh).toHaveBeenCalledTimes(1);
  expect((await getGitHubAuthStatus(userId)).state).toBe('temporary_error');
  await getPool().query('UPDATE system_state SET value=value || $2::jsonb WHERE key=$1', [
    `github-auth:${userId}`,
    JSON.stringify({ retryAt: new Date(0).toISOString() }),
  ]);
  expect(await githubReadToken(userId)).toBe('new-access');
});
it('permanent rejection asks to reconnect, and fresh login clears the stale failure', async () => {
  refresh.mockResolvedValueOnce(
    Response.json({ error: 'bad_refresh_token', error_description: 'do-not-display' }),
  );
  await expect(githubReadToken(userId)).rejects.toThrow('重新连接');
  await expect(githubReadToken(userId)).rejects.toThrow('重新连接');
  expect(refresh).toHaveBeenCalledTimes(1);
  expect((await getGitHubAuthStatus(userId)).state).toBe('reconnect_required');
  await getPool().query(
    'UPDATE account SET "accessToken"=$2,"accessTokenExpiresAt"=now()+interval \'8 hours\' WHERE id=$1',
    [userId, await encrypt('login-access')],
  );
  expect(await githubReadToken(userId)).toBe('login-access');
  expect((await getGitHubAuthStatus(userId)).state).toBe('connected');
  await markGitHubRejected(userId, 'old-access');
  expect((await getGitHubAuthStatus(userId)).state).toBe('connected');
});
it('expired refresh or removed allowlist never sends credentials upstream', async () => {
  await getPool().query(
    'UPDATE account SET "refreshTokenExpiresAt"=now()-interval \'1 day\' WHERE id=$1',
    [userId],
  );
  await expect(githubReadToken(userId)).rejects.toThrow('重新连接');
  vi.stubEnv('ALLOWED_GITHUB_USER_IDS', '999');
  await expect(githubReadToken(userId)).rejects.toThrow('允许名单');
  expect(refresh).not.toHaveBeenCalled();
});
it('caller cancellation during rotation still persists new tokens before returning abort', async () => {
  const controller = new AbortController();
  refresh.mockImplementationOnce(async () => {
    controller.abort(new Error('cancelled'));
    return Response.json({
      access_token: 'rotated',
      refresh_token: 'rotated-refresh',
      expires_in: 28800,
    });
  });
  await expect(githubReadToken(userId, { signal: controller.signal })).rejects.toThrow('cancelled');
  expect(await githubReadToken(userId)).toBe('rotated');
  expect(refresh).toHaveBeenCalledTimes(1);
});
it('401 renewal uses the latest token if another request already refreshed it', async () => {
  expect(await githubReadToken(userId, { rejectedToken: 'old-access' })).toBe('new-access');
  expect(await githubReadToken(userId, { rejectedToken: 'old-access' })).toBe('new-access');
  expect(refresh).toHaveBeenCalledTimes(1);
});
it('does not expose secrets in the public status and isolates other users', async () => {
  const status = JSON.stringify(await getGitHubAuthStatus(userId));
  expect(status).not.toMatch(/old-access|old-refresh|test-client-secret|fingerprint/);
  expect((await getGitHubAuthStatus('missing-user')).state).toBe('public');
  expect(await githubReadToken('missing-user')).toBe('');
  expect(refresh).not.toHaveBeenCalled();
});

it('Star authorization failure stays enabled for recovery after reauthentication', async () => {
  await setStarSync(userId, true);
  refresh.mockResolvedValueOnce(Response.json({ error: 'bad_refresh_token' }));
  await expect(syncStarred(userId)).rejects.toThrow('重新连接');
  expect(await getStarSync(userId)).toMatchObject({
    enabled: true,
    error: expect.stringContaining('重新连接'),
  });
});
it('refreshes near expiry and rejects malformed success without overwriting credentials', async () => {
  await getPool().query(
    'UPDATE account SET "accessTokenExpiresAt"=now()+interval \'30 seconds\' WHERE id=$1',
    [userId],
  );
  const before = await account();
  refresh.mockResolvedValueOnce(Response.json({ access_token: '' }));
  await expect(githubReadToken(userId)).rejects.toThrow('自动重试');
  expect((await account()).accessToken).toBe(before.accessToken);
  expect(refresh).toHaveBeenCalledTimes(1);
});
it('configured credential errors clear when config changes without a login', async () => {
  vi.stubEnv('GITHUB_READ_TOKEN', 'configured-one');
  await markGitHubRejected(userId, 'configured-one');
  expect((await getGitHubAuthStatus(userId)).state).toBe('configuration_error');
  vi.stubEnv('GITHUB_READ_TOKEN', 'configured-two');
  expect((await getGitHubAuthStatus(userId)).state).toBe('configured');
  expect(refresh).not.toHaveBeenCalled();
});
