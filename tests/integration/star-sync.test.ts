import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, afterEach, expect, it, vi } from 'vitest';
import { migrate } from '../../scripts/migrate';
import { getPool } from '../../src/server/db/client';
import { getSubscriptions } from '../../src/server/db/store';
import { GitHubConnector, GitHubError } from '../../src/server/connectors/github';
import {
  addSubscription,
  deleteSubscription,
  updateSubscription,
} from '../../src/server/subscriptions/service';
import {
  getStarSync,
  requestStarSync,
  scheduleStarSync,
  setStarSync,
  syncStarred,
} from '../../src/server/subscriptions/star-sync';

const user = `auto-${randomUUID()}`;
const other = `auto-${randomUUID()}`;
const repository = (id: number) => ({
  id,
  name: `repo-${id}`,
  full_name: `example/repo-${id}`,
  description: 'test',
  html_url: `https://github.com/example/repo-${id}`,
  created_at: new Date().toISOString(),
  fork: false,
  private: false,
  owner: { id: 7, login: 'example' },
});
const makeConnector = (read: (page: number) => Promise<{ ids: number[]; more?: boolean }>) =>
  new GitHubConnector(async (path) => {
    if (path.startsWith('/user/'))
      return { data: { id: 123, login: 'my-account' }, hasNext: false };
    if (path.startsWith('/repos/'))
      return { data: repository(Number(path.split('-').at(-1))), hasNext: false };
    const page = Number(new URL(path, 'https://api.github.com').searchParams.get('page'));
    const result = await read(page);
    return { data: result.ids.map(repository), hasNext: !!result.more };
  });
beforeAll(async () => {
  await migrate();
  for (const [id, account] of [
    [user, '123'],
    [other, '456'],
  ]) {
    await getPool().query('INSERT INTO app_users(id,name) VALUES($1,$2)', [id, 'test']);
    await getPool().query(
      'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,false,now(),now())',
      [id, 'test', `${id}@example.test`],
    );
    await getPool().query(
      'INSERT INTO account(id,"userId","providerId","accountId","createdAt","updatedAt") VALUES($1,$1,$2,$3,now(),now())',
      [id, 'github', account],
    );
  }
});
beforeEach(async () => {
  vi.stubEnv('APP_MODE', 'live');
  vi.stubEnv('ALLOWED_GITHUB_USER_IDS', '123');
  for (const table of ['jobs', 'subscriptions', 'star_sync_exclusions', 'star_sync'])
    await getPool().query(`DELETE FROM ${table} WHERE user_id=ANY($1::text[])`, [[user, other]]);
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await getPool().query('DELETE FROM jobs WHERE user_id=ANY($1::text[])', [[user, other]]);
  await getPool().query('DELETE FROM subscriptions WHERE user_id=ANY($1::text[])', [[user, other]]);
  await getPool().query('DELETE FROM app_users WHERE id=ANY($1::text[])', [[user, other]]);
  await getPool().query('DELETE FROM "user" WHERE id=ANY($1::text[])', [[user, other]]);
  await getPool().end();
});

it('schedules allowed accounts automatically and deduplicates concurrent ticks and manual checks', async () => {
  await Promise.all([scheduleStarSync(), scheduleStarSync()]);
  expect(await getStarSync(user)).toMatchObject({ enabled: true, intervalMinutes: 5 });
  expect(await getStarSync(other)).toBeNull();
  await requestStarSync(user);
  expect(
    (await getPool().query("SELECT id FROM jobs WHERE user_id=$1 AND kind='stars'", [user])).rows,
  ).toHaveLength(1);
  await setStarSync(user, false);
  await scheduleStarSync();
  expect((await getStarSync(user))?.enabled).toBe(false);
});

it('discovers a newly starred repository on the next scan with one durable release job each', async () => {
  await setStarSync(user, true);
  let ids = [1];
  const connector = makeConnector(async () => ({ ids }));
  await syncStarred(user, connector);
  ids = [2, 1];
  await syncStarred(user, connector);
  expect(await getStarSync(user)).toMatchObject({ lastAdded: 1, nextPage: 1, error: null });
  await syncStarred(user, connector);
  expect(await getSubscriptions(user)).toHaveLength(2);
  expect(await getSubscriptions(other)).toHaveLength(0);
  expect(
    (await getPool().query("SELECT id FROM jobs WHERE user_id=$1 AND kind='sync'", [user])).rows,
  ).toHaveLength(2);
  expect((await getStarSync(user))?.lastAdded).toBe(0);
});

it('preserves paused and unstarred subscriptions, respects deletion, and allows manual reimport', async () => {
  await setStarSync(user, true);
  const connector = makeConnector(async () => ({ ids: [1, 2] }));
  await syncStarred(user, connector);
  const subs = await getSubscriptions(user);
  await updateSubscription(user, subs[0].id, { enabled: false });
  await deleteSubscription(other, subs[1].id);
  expect(await getSubscriptions(user)).toHaveLength(2);
  await syncStarred(user, connector);
  expect((await getSubscriptions(user)).find((s) => s.id === subs[0].id)?.enabled).toBe(false);
  await deleteSubscription(user, subs[1].id);
  await syncStarred(user, connector);
  expect(await getSubscriptions(user)).toHaveLength(1);
  await addSubscription(user, 'repo', subs[1].name, connector);
  expect(
    (await getPool().query('SELECT * FROM star_sync_exclusions WHERE user_id=$1', [user])).rows,
  ).toHaveLength(0);
  await syncStarred(
    user,
    makeConnector(async () => ({ ids: [] })),
  );
  expect(await getSubscriptions(user)).toHaveLength(2);
});

it('resumes a failed second page without duplicating the first page and counts the entire scan', async () => {
  await setStarSync(user, true);
  let fail = true;
  const pages: number[] = [];
  const connector = makeConnector(async (page) => {
    pages.push(page);
    if (page === 2 && fail) throw new GitHubError('临时失败');
    return { ids: [page], more: page === 1 };
  });
  await expect(syncStarred(user, connector)).rejects.toThrow('临时失败');
  expect(await getStarSync(user)).toMatchObject({ nextPage: 2, error: '临时失败' });
  fail = false;
  await syncStarred(user, connector);
  expect(pages).toEqual([1, 2, 2]);
  expect(await getStarSync(user)).toMatchObject({ lastAdded: 2, nextPage: 1, error: null });
});

it('bounds each job to five pages and resumes the remaining pages later', async () => {
  await setStarSync(user, true);
  const pages: number[] = [];
  const connector = makeConnector(async (page) => {
    pages.push(page);
    return { ids: [page], more: page < 6 };
  });
  await syncStarred(user, connector);
  expect(await getStarSync(user)).toMatchObject({ nextPage: 6, lastSyncAt: null });
  await syncStarred(user, connector);
  expect(pages).toEqual([1, 2, 3, 4, 5, 6]);
  expect(await getStarSync(user)).toMatchObject({ nextPage: 1, lastAdded: 6 });
});

it('retains rate-limit deadlines across toggles and manual requests, and pauses expired credentials', async () => {
  await setStarSync(user, true);
  await expect(
    syncStarred(
      user,
      makeConnector(async () => {
        throw new GitHubError('限流', 429, 600);
      }),
    ),
  ).rejects.toThrow('限流');
  const deadline = (await getStarSync(user))!.nextSyncAt;
  await setStarSync(user, false);
  await setStarSync(user, true);
  expect((await getStarSync(user))!.nextSyncAt).toBe(deadline);
  await expect(requestStarSync(user)).rejects.toThrow('限流等待');
  const read = vi.fn(async () => ({ ids: [1] }));
  await expect(syncStarred(user, makeConnector(read))).rejects.toThrow('限流等待');
  expect(read).not.toHaveBeenCalled();
  await getPool().query("UPDATE star_sync SET data=data - 'retryAt' WHERE user_id=$1", [user]);
  await expect(
    syncStarred(
      user,
      makeConnector(async () => {
        throw new GitHubError('授权已过期，请重新登录。', 401);
      }),
    ),
  ).rejects.toThrow('过期');
  expect(await getStarSync(user)).toMatchObject({
    enabled: false,
    error: '授权已过期，请重新登录。',
  });
});

it.each([false, true])(
  'prevents an in-flight scan from writing after disable/re-enable=%s',
  async (reenable) => {
    await setStarSync(user, true);
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scan = syncStarred(
      user,
      makeConnector(async () => {
        entered();
        await gate;
        return { ids: [1] };
      }),
    );
    await started;
    await setStarSync(user, false);
    if (reenable) await setStarSync(user, true);
    release();
    await scan;
    expect(await getSubscriptions(user)).toHaveLength(0);
    expect(await getStarSync(user)).toMatchObject({
      enabled: reenable,
      nextPage: 1,
      lastSyncAt: null,
    });
  },
);

it('does not import results received after cancellation', async () => {
  await setStarSync(user, true);
  const controller = new AbortController();
  await expect(
    syncStarred(
      user,
      makeConnector(async () => {
        controller.abort();
        return { ids: [1] };
      }),
      controller.signal,
    ),
  ).rejects.toThrow();
  expect(await getSubscriptions(user)).toHaveLength(0);
  expect(await getStarSync(user)).toMatchObject({ lastSyncAt: null, error: null });
});

it('reports the repository cap while retaining imports and the resumable checkpoint', async () => {
  await setStarSync(user, true);
  await expect(
    syncStarred(
      user,
      makeConnector(async (page) => ({
        ids: Array.from({ length: page === 3 ? 1 : 50 }, (_, i) => (page - 1) * 50 + i + 1),
        more: page < 3,
      })),
    ),
  ).rejects.toThrow('数量上限');
  expect(await getSubscriptions(user)).toHaveLength(100);
  expect(await getStarSync(user)).toMatchObject({
    nextPage: 3,
    error: '已达到本地试用的订阅数量上限。',
  });
});
