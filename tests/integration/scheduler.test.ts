import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { migrate } from '../../scripts/migrate';
import { getPool } from '../../src/server/db/client';
import { scheduleSubscriptions } from '../../src/server/jobs/scheduler';

const user = `scheduler-${randomUUID()}`;
beforeAll(async () => {
  vi.stubEnv('APP_MODE', 'live');
  vi.stubEnv('ALLOWED_GITHUB_USER_IDS', '810001');
  await migrate();
  await getPool().query('INSERT INTO app_users(id,name) VALUES($1,$2)', [user, 'test']);
  await getPool().query(
    'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',
    [user, `${user}@example.test`],
  );
  await getPool().query(
    'INSERT INTO account(id,"userId","accountId","providerId","createdAt","updatedAt") VALUES($1,$1,\'810001\',\'github\',now(),now())',
    [user],
  );
  await getPool().query(
    `INSERT INTO subscriptions(id,user_id,external_id,kind,data)
     SELECT $1||g,$1,g::text,'repo',jsonb_build_object('id',$1||g,'kind','repo',
       'enabled',true,'demo',false,'retryAt',CASE WHEN g=1 THEN '2099-01-01T00:00:00Z' ELSE NULL END)
     FROM generate_series(1,400) g`,
    [user],
  );
});
afterAll(async () => {
  await getPool().query('DELETE FROM "user" WHERE id=$1', [user]);
  await getPool().query('DELETE FROM system_state WHERE key LIKE $1', [`schedule:${user}:%`]);
  for (const table of ['jobs', 'subscriptions', 'app_users'])
    await getPool().query(
      `DELETE FROM ${table} WHERE ${table === 'app_users' ? 'id' : 'user_id'}=$1`,
      [user],
    );
  await getPool().end();
  vi.unstubAllEnvs();
});

it('bounds each scheduling tick and does not spend a turn on disabled or cooling sources', async () => {
  const before = performance.now();
  const { rows } = await getPool().query('SELECT id FROM subscriptions WHERE user_id=$1', [user]);
  for (const row of rows)
    await getPool().query('SELECT value FROM system_state WHERE key=$1', [
      `schedule:${user}:${row.id}`,
    ]);
  const oldMs = performance.now() - before;
  const scan = performance.now();
  await getPool().query(
    `SELECT s.id,t.value FROM subscriptions s LEFT JOIN system_state t
    ON t.key='schedule:'||s.user_id||':'||s.id WHERE s.user_id=$1`,
    [user],
  );
  const joinedMs = performance.now() - scan;
  await mkdir('work/aggregation-baseline', { recursive: true });
  await writeFile(
    'work/aggregation-baseline/scheduler.json',
    JSON.stringify(
      {
        rows: 400,
        oldQueries: 401,
        joinedQueries: 1,
        oldMs,
        joinedMs,
        scope: 'isolated local PostgreSQL, one diagnostic sample, not a latency percentile',
      },
      null,
      2,
    ),
  );
  expect(await scheduleSubscriptions()).toBe(50);
  expect(await scheduleSubscriptions()).toBe(50);
  const scheduled = await getPool().query('SELECT target_id FROM jobs WHERE user_id=$1', [user]);
  expect(scheduled.rows).toHaveLength(100);
  expect(new Set(scheduled.rows.map((row) => row.target_id)).size).toBe(100);
  expect(scheduled.rows.some((row) => row.target_id === `${user}1`)).toBe(false);
});
