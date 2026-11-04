import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PgBoss } from 'pg-boss';
import { migrate } from '../../scripts/migrate';
import { getPool } from '../../src/server/db/client';
import { createBoss, enqueue, publishPending, QUEUE } from '../../src/server/jobs/queue';
import { workTaskLanes } from '../../src/server/jobs/workers';
import { mkdir, writeFile } from 'node:fs/promises';
import { summarize } from '../../scripts/benchmarks/statistics';

const user = `fairness-${randomUUID()}`;
const schema = `fairness_${randomUUID().replaceAll('-', '')}`;
let boss: PgBoss;
beforeAll(async () => {
  await migrate();
  await getPool().query('INSERT INTO app_users(id,name) VALUES($1,$2)', [user, 'test']);
  boss = await createBoss(schema);
});
afterAll(async () => {
  await boss?.stop();
  await getPool().query(`DROP SCHEMA "${schema}" CASCADE`);
  await getPool().query('DELETE FROM jobs WHERE user_id=$1', [user]);
  await getPool().query('DELETE FROM subscriptions WHERE user_id=$1', [user]);
  await getPool().query('DELETE FROM app_users WHERE id=$1', [user]);
  await getPool().end();
});

it('allows GitHub work to advance while AI and YouTube lanes remain blocked', async () => {
  const ai = await enqueue(user, 'summary', 'blocked-model');
  for (let i = 0; i < 40; i++) await enqueue(user, 'summary', `ai-backlog-${i}`);
  const youtube = await enqueue(user, 'sync', 'blocked-youtube');
  const github = await enqueue(user, 'sync', 'ready-github');
  const githubIds = new Set([github.id]);
  for (let index = 1; index < 12; index++)
    githubIds.add((await enqueue(user, 'sync', `ready-github-${index}`)).id);
  await getPool().query(
    "INSERT INTO subscriptions(id,user_id,external_id,kind,platform,data) VALUES($1,$2,$1,'channel','youtube',$3)",
    ['blocked-youtube', user, { platform: 'youtube', id: 'blocked-youtube' }],
  );
  const started = new Set<string>();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waits: number[] = [];
  let legacyId: string | undefined;
  const published = Date.now();
  try {
    await workTaskLanes(boss, async (deliveries) => {
      for (const delivery of deliveries) {
        if (delivery.data.id === legacyId) {
          started.add(legacyId);
          continue;
        }
        if (![ai.id, youtube.id].includes(delivery.data.id) && !githubIds.has(delivery.data.id))
          continue;
        started.add(delivery.data.id);
        if (githubIds.has(delivery.data.id)) waits.push(Date.now() - published);
        else await gate;
      }
    });
    await publishPending(boss);
    await expect.poll(() => started.has(ai.id), { timeout: 2000 }).toBe(true);
    await expect.poll(() => started.has(github.id), { timeout: 2000 }).toBe(true);
    await expect.poll(() => started.has(youtube.id), { timeout: 2000 }).toBe(true);
    expect(waits[0]).toBeLessThan(2000);
    await expect.poll(() => waits.length, { timeout: 8000 }).toBe(12);
    expect(summarize(waits).p95Ms).toBeLessThan(8000);
    await mkdir('work/aggregation-baseline', { recursive: true });
    await writeFile(
      'work/aggregation-baseline/queue.json',
      JSON.stringify(
        {
          experiment: 'blocked-ai-and-youtube',
          githubWaitMs: waits[0],
          githubCohort: summarize(waits),
          lanes: 3,
          startedJobs: started.size,
          firstBudgetMs: 2000,
          cohortBudgetMs: 8000,
          scope: 'one local isolated PostgreSQL regression, not a production p95',
        },
        null,
        2,
      ),
    );
    expect(await boss.findJobs(QUEUE, { key: github.id })).toHaveLength(1);
    expect(
      (
        await getPool().query(
          'SELECT count(*)::int AS count FROM jobs WHERE user_id=$1 AND enqueued_at IS NULL',
          [user],
        )
      ).rows[0].count,
    ).toBeGreaterThan(0);
    release();
    const legacy = await enqueue(user, 'sync', 'legacy-source');
    legacyId = legacy.id;
    await boss.send(QUEUE, { id: legacy.id }, { id: legacy.id, singletonKey: legacy.id });
    // Legacy priority-zero deliveries keep their pre-upgrade position; drain, do not republish them.
    await expect.poll(() => started.has(legacy.id), { timeout: 12000 }).toBe(true);
  } finally {
    release();
  }
});
