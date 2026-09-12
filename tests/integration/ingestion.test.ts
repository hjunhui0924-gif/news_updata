import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getPool } from '../../src/server/db/client';
import { migrate } from '../../scripts/migrate';
import { GitHubConnector, GitHubError } from '../../src/server/connectors/github';
import { addSubscription, syncSubscription } from '../../src/server/subscriptions/service';
import { getItems, patchItemState } from '../../src/server/db/store';
process.env.APP_MODE = 'demo';
const userId = `test-ingest-${randomUUID()}`;
let body = 'Initial release notes';
let failSecond = false;
const now = new Date().toISOString();
const connector = new GitHubConnector(async (path) => {
  if (path === '/repos/example/repo')
    return {
      hasNext: false,
      data: {
        id: 101,
        name: 'repo',
        full_name: 'example/repo',
        description: 'Example',
        html_url: 'https://github.com/example/repo',
        created_at: now,
        fork: false,
        private: false,
        owner: { id: 102, login: 'example' },
      },
    };
  if (path.includes('page=2') && failSecond) throw new Error('Network interrupted');
  const id = path.includes('page=2') ? 202 : 201;
  return {
    hasNext: id === 201,
    data: [
      {
        id,
        name: `Version ${id}`,
        tag_name: `v${id}`,
        body,
        html_url: `https://github.com/example/repo/releases/tag/v${id}`,
        draft: false,
        prerelease: false,
        published_at: now,
        created_at: now,
      },
    ],
  };
});
beforeAll(async () => {
  await migrate();
  await getPool().query('INSERT INTO app_users(id,name) VALUES($1,$2)', [userId, 'test']);
});
afterAll(async () => {
  await getPool().query('DELETE FROM jobs WHERE user_id=$1', [userId]);
  await getPool().query('DELETE FROM items WHERE user_id=$1', [userId]);
  await getPool().query('DELETE FROM subscriptions WHERE user_id=$1', [userId]);
  await getPool().query('DELETE FROM system_state WHERE key LIKE $1', [`%${userId}%`]);
  await getPool().query('DELETE FROM app_users WHERE id=$1', [userId]);
  await getPool().end();
});
it('resumes after a page failure, de-duplicates updates and preserves saved state after edits', async () => {
  const [sub, duplicate] = await Promise.all([
    addSubscription(userId, 'repo', 'example/repo', connector),
    addSubscription(userId, 'repo', 'example/repo', connector),
  ]);
  expect(sub.id).toBe(duplicate.id);
  failSecond = true;
  await expect(syncSubscription(userId, sub.id, connector)).rejects.toThrow('interrupted');
  expect(await getItems(userId)).toHaveLength(1);
  failSecond = false;
  await syncSubscription(userId, sub.id, connector);
  let items = await getItems(userId);
  expect(items).toHaveLength(2);
  expect(items.every((x) => x.backfill)).toBe(true);
  await patchItemState(userId, items[0].id, { saved: true });
  body = 'Edited notes';
  await syncSubscription(userId, sub.id, connector);
  items = await getItems(userId);
  expect(items).toHaveLength(2);
  expect(items.find((x) => x.saved)?.body).toBe('Edited notes');
});

it('honors a persisted GitHub reset deadline before issuing another request', async () => {
  const sub = await addSubscription(userId, 'repo', 'example/repo', connector);
  let requests = 0;
  const limited = new GitHubConnector(async () => {
    requests++;
    throw new GitHubError('limited', 429, 3600);
  });
  await expect(syncSubscription(userId, sub.id, limited)).rejects.toThrow('limited');
  await expect(syncSubscription(userId, sub.id, limited)).rejects.toThrow('等待');
  expect(requests).toBe(1);
});

it('aborted synchronization never starts a request or changes stored entries', async () => {
  let requests = 0;
  const abort = new AbortController();
  abort.abort(new Error('expired'));
  const sub = await addSubscription(userId, 'repo', 'example/repo', connector);
  const before = await getItems(userId);
  await expect(
    syncSubscription(
      userId,
      sub.id,
      new GitHubConnector(async () => {
        requests++;
        throw new Error('unexpected request');
      }),
      abort.signal,
    ),
  ).rejects.toThrow('expired');
  expect(requests).toBe(0);
  expect(await getItems(userId)).toEqual(before);
});
