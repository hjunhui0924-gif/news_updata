import { afterAll, beforeAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { migrate } from '../../scripts/migrate';
import { getPool } from '../../src/server/db/client';
import { GitHubConnector, GitHubError } from '../../src/server/connectors/github';
import { importFollowing } from '../../src/server/subscriptions/following';

const userId = `following-${randomUUID()}`;

const connector = new GitHubConnector(async (path) => {
  const login = path.match(/^\/users\/([^/]+)$/)?.[1];
  if (!login) throw new GitHubError(`unexpected path: ${path}`, 500);
  if (login === 'missing') throw new GitHubError('账号不存在', 404);
  return {
    hasNext: false,
    data: {
      id: ['alice', 'renamed'].includes(login) ? 10 : 11,
      login,
      type: 'User',
      bio: `${login} bio`,
    },
  };
});

beforeAll(async () => {
  await migrate();
  await getPool().query('INSERT INTO app_users(id,name) VALUES($1,$2)', [userId, 'following test']);
});

afterAll(async () => {
  await getPool().query('DELETE FROM jobs WHERE user_id=$1', [userId]);
  await getPool().query('DELETE FROM subscriptions WHERE user_id=$1', [userId]);
  await getPool().query('DELETE FROM app_users WHERE id=$1', [userId]);
  await getPool().end();
});

it('persists successful following imports, reports failures, and makes retries idempotent', async () => {
  const first = await importFollowing(
    userId,
    { usernames: ['alice', 'ALICE', 'missing'] },
    connector,
  );
  expect(first.added).toHaveLength(1);
  expect(first.receipt).toEqual({ created: 1, existing: 0, failed: 1 });
  expect(first.failed).toEqual([{ name: 'missing', error: '账号不存在' }]);

  const second = await importFollowing(userId, { usernames: ['alice'] }, connector);
  expect(second.added).toHaveLength(1);
  expect(second.receipt).toEqual({ created: 0, existing: 1, failed: 0 });
  expect(second.added[0].id).toBe(first.added[0].id);
  const alias = await importFollowing(userId, { usernames: ['renamed'] }, connector);
  expect(alias.receipt).toEqual({ created: 0, existing: 1, failed: 0 });
  expect(alias.accepted).toEqual(['renamed']);
  expect(
    (await getPool().query('SELECT id FROM subscriptions WHERE user_id=$1', [userId])).rows,
  ).toHaveLength(1);
  expect(
    (await getPool().query('SELECT id FROM jobs WHERE user_id=$1', [userId])).rows,
  ).toHaveLength(1);
});

it('counts concurrent imports from their atomic create outcomes', async () => {
  const results = await Promise.all([
    importFollowing(userId, { usernames: ['carol'] }, connector),
    importFollowing(userId, { usernames: ['CAROL'] }, connector),
  ]);
  expect(results.reduce((count, result) => count + result.receipt.created, 0)).toBe(1);
  expect(results.reduce((count, result) => count + result.receipt.existing, 0)).toBe(1);
});
