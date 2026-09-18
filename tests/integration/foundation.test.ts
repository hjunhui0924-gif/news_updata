import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getPool } from '../../src/server/db/client';
import { migrate } from '../../scripts/migrate';
import {
  createBoss,
  enqueue,
  publishPending,
  reconcileJobs,
  QUEUE,
} from '../../src/server/jobs/queue';
import type { PgBoss } from 'pg-boss';

process.env.APP_MODE = 'demo';
const userId = `test-${randomUUID()}`;
let boss: PgBoss;
beforeAll(async () => {
  await migrate();
  await migrate();
  await getPool().query('INSERT INTO app_users(id,name) VALUES($1,$2)', [userId, 'test']);
  boss = await createBoss();
});
afterAll(async () => {
  await getPool().query('DELETE FROM jobs WHERE user_id=$1', [userId]);
  await getPool().query('DELETE FROM app_users WHERE id=$1', [userId]);
  await boss?.stop();
  await getPool().end();
});
describe('persistent foundation', () => {
  it('replayed publication stays singular and terminal delivery is requeued after a worker interruption', async () => {
    const job = await enqueue(userId, 'sync', 'crash-test-source');
    await publishPending(boss);
    await getPool().query('UPDATE jobs SET enqueued_at=NULL WHERE id=$1', [job.id]);
    await Promise.all([publishPending(boss), publishPending(boss)]);
    const deliveries = await boss.findJobs(QUEUE, { key: job.id });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].id).toBe(job.id);
    await getPool().query("UPDATE jobs SET status='running' WHERE id=$1", [job.id]);
    await getPool().query("UPDATE pgboss.job SET state='failed' WHERE id=$1", [job.id]);
    await reconcileJobs(boss);
    expect(
      (await getPool().query('SELECT status,enqueued_at FROM jobs WHERE id=$1', [job.id])).rows[0],
    ).toMatchObject({ status: 'pending', enqueued_at: null });
    await publishPending(boss);
    const replayed = await boss.findJobs(QUEUE, { key: job.id });
    expect(replayed).toHaveLength(1);
    expect(replayed[0].id).toBe(job.id);
    await boss.deleteJob(QUEUE, job.id);
    await getPool().query("UPDATE jobs SET status='failed' WHERE id=$1", [job.id]);
  });
  it('creates only one active job under concurrent requests and publishes it', async () => {
    const jobs = await Promise.all(
      Array.from({ length: 8 }, () => enqueue(userId, 'sync', 'foundation-source')),
    );
    expect(new Set(jobs.map((j) => j.id)).size).toBe(1);
    await publishPending(boss);
    const pending = await boss.findJobs<{ id: string }>(QUEUE, { key: jobs[0].id });
    expect(pending.some((job) => job.data.id === jobs[0].id)).toBe(true);
    await boss.deleteJob(
      QUEUE,
      pending.map((x) => x.id),
    );
  });
  it('requeues a stale active sync job whose queue delivery disappeared after a restart', async () => {
    const job = await enqueue(userId, 'sync', 'stale-restart-source');
    await publishPending(boss);
    await getPool().query(
      "UPDATE jobs SET status='running',enqueued_at=now()-interval '11 minutes' WHERE id=$1",
      [job.id],
    );
    await boss.deleteJob(QUEUE, job.id);
    await reconcileJobs(boss);
    expect(
      (await getPool().query('SELECT status,enqueued_at FROM jobs WHERE id=$1', [job.id])).rows[0],
    ).toMatchObject({ status: 'pending', enqueued_at: null });
    await publishPending(boss);
    const replayed = await boss.findJobs(QUEUE, { key: job.id });
    expect(replayed).toHaveLength(1);
    expect(replayed[0].id).toBe(job.id);
    await boss.deleteJob(QUEUE, job.id);
    await getPool().query("UPDATE jobs SET status='failed' WHERE id=$1", [job.id]);
  });
});
