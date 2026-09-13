import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { symmetricEncrypt } from 'better-auth/crypto';
import { githubReadToken } from '../../src/server/connectors/github-user';
import { randomUUID } from 'node:crypto';
import { getPool } from '../../src/server/db/client';
import { migrate } from '../../scripts/migrate';
import { GitHubConnector, GitHubError } from '../../src/server/connectors/github';
import { previewStarred, importStarred } from '../../src/server/subscriptions/starred';
import { syncSubscription } from '../../src/server/subscriptions/service';

const userId = `stars-${randomUUID()}`;
const otherId = `stars-${randomUUID()}`;
const repository = {
  id: 567,
  name: 'repo',
  full_name: 'example/repo',
  description: 'A starred repository',
  html_url: 'https://github.com/example/repo',
  created_at: new Date().toISOString(),
  fork: false,
  private: false,
  owner: { id: 7, login: 'example' },
};
const connector = new GitHubConnector(async (path) => {
  if (path === '/user/123') return { data: { id: 123, login: 'my-account' }, hasNext: false };
  if (path.startsWith('/users/my-account/starred?')) return { data: [repository], hasNext: false };
  if (path.toLowerCase() === '/repos/example/repo') return { data: repository, hasNext: false };
  throw new GitHubError('来源不存在', 404);
});
beforeAll(async () => {
  await migrate();
  for (const id of [userId, otherId])
    await getPool().query('INSERT INTO app_users(id,name) VALUES($1,$2)', [id, 'test']);
  await getPool().query(
    'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,false,now(),now())',
    [userId, 'test', `${userId}@example.test`],
  );
  await getPool().query(
    'INSERT INTO account(id,"userId","providerId","accountId","createdAt","updatedAt") VALUES($1,$1,$2,$3,now(),now())',
    [userId, 'github', '123'],
  );
});
afterAll(async () => {
  for (const id of [userId, otherId]) {
    await getPool().query('DELETE FROM jobs WHERE user_id=$1', [id]);
    await getPool().query('DELETE FROM subscriptions WHERE user_id=$1', [id]);
    await getPool().query('DELETE FROM app_users WHERE id=$1', [id]);
  }
  await getPool().query('DELETE FROM "user" WHERE id=$1', [userId]);
  await getPool().end();
});
it('imports selected stars with durable jobs, reports partial errors and deduplicates retries', async () => {
  const result = await importStarred(
    userId,
    { repositories: ['example/repo', 'EXAMPLE/repo', 'missing/repo'] },
    connector,
  );
  expect(result.added).toHaveLength(1);
  expect(result.failed).toEqual([{ name: 'missing/repo', error: '来源不存在' }]);
  await importStarred(userId, { repositories: ['example/repo'] }, connector);
  const jobs = await getPool().query('SELECT * FROM jobs WHERE user_id=$1', [userId]);
  expect(jobs.rows).toHaveLength(1);
  expect(jobs.rows[0]).toMatchObject({ kind: 'sync', target_id: result.added[0].id });
  const own = await previewStarred(userId, {}, connector);
  expect(own.username).toBe('my-account');
  expect(own.repositories[0].subscribed).toBe(true);
  expect(
    (await previewStarred(otherId, { username: 'my-account' }, connector)).repositories[0]
      .subscribed,
  ).toBe(false);
  await expect(previewStarred(otherId, {}, connector)).rejects.toThrow('先使用 GitHub 登录');
});
it('validates the whole selection before creating any subscriptions', async () => {
  await expect(
    importStarred(otherId, { repositories: ['example/repo', 'https://evil.test/x'] }, connector),
  ).rejects.toThrow();
  await expect(
    importStarred(otherId, { repositories: Array(21).fill('example/repo') }, connector),
  ).rejects.toThrow();
  expect(
    (await getPool().query('SELECT id FROM subscriptions WHERE user_id=$1', [otherId])).rows,
  ).toHaveLength(0);
});
it('reads only the caller OAuth credential, checks permission/expiry and redacts decryption errors', async () => {
  vi.stubEnv('GITHUB_READ_TOKEN', '');
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-only-encryption-key-at-least-32-characters');
  vi.stubEnv('ALLOWED_GITHUB_USER_IDS', '123');
  const encrypted = await symmetricEncrypt({
    key: process.env.BETTER_AUTH_SECRET!,
    data: 'test-oauth-token',
  });
  try {
    await getPool().query('UPDATE account SET "accessToken"=$2 WHERE "userId"=$1', [
      userId,
      encrypted,
    ]);
    expect(await githubReadToken(userId)).toBe('test-oauth-token');
    expect(await githubReadToken(otherId)).toBe('');
    vi.stubEnv('ALLOWED_GITHUB_USER_IDS', '999');
    await expect(githubReadToken(userId)).rejects.toThrow('允许名单');
    vi.stubEnv('ALLOWED_GITHUB_USER_IDS', '123');
    await getPool().query(
      'UPDATE account SET "accessTokenExpiresAt"=now()-interval \'1 minute\' WHERE "userId"=$1',
      [userId],
    );
    await expect(githubReadToken(userId)).rejects.toThrow('过期');
    const { rows: subscriptions } = await getPool().query(
      'SELECT id FROM subscriptions WHERE user_id=$1',
      [userId],
    );
    await expect(syncSubscription(userId, subscriptions[0].id)).rejects.toThrow('过期');
    const { rows: paused } = await getPool().query('SELECT data FROM subscriptions WHERE id=$1', [
      subscriptions[0].id,
    ]);
    expect(paused[0].data).toMatchObject({
      enabled: false,
      coverage: 'partial',
      error: 'GitHub 授权已过期，请重新登录。',
    });
    await getPool().query(
      'UPDATE account SET "accessTokenExpiresAt"=NULL,"accessToken"=$2 WHERE "userId"=$1',
      [userId, 'invalid-sensitive-token'],
    );
    await expect(githubReadToken(userId)).rejects.toThrow('GitHub 授权无法读取，请重新登录。');
  } finally {
    vi.unstubAllEnvs();
  }
});
