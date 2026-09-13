import { getConfig } from '../server/config';
import { getPool } from '../server/db/client';
import { createBoss, enqueue, publishPending, reconcileJobs, QUEUE } from '../server/jobs/queue';
import { syncSubscription } from '../server/subscriptions/service';
import type { Subscription } from '../shared/types';
import pino from 'pino';
import { runAi, AiError } from '../server/ai/service';
import { GitHubError } from '../server/connectors/github';
import { scheduleStarSync, syncStarred } from '../server/subscriptions/star-sync';
import { getTrending } from '../server/discovery/service';

const config = getConfig();
const logger = pino({ level: config.LOG_LEVEL });
const boss = await createBoss();
await boss.work<{ id: string }, void, { includeMetadata: true; pollingIntervalSeconds: 1 }>(
  QUEUE,
  { includeMetadata: true, pollingIntervalSeconds: 1 },
  async (jobs) => {
    for (const job of jobs) {
      const result = await getPool().query('SELECT * FROM jobs WHERE id=$1', [job.data.id]);
      const task = result.rows[0];
      if (!task || task.status === 'completed' || task.status === 'failed') continue;
      await getPool().query("UPDATE jobs SET status='running',updated_at=now() WHERE id=$1", [
        task.id,
      ]);
      try {
        if (task.kind === 'sync')
          await syncSubscription(
            task.user_id,
            task.target_id,
            undefined,
            AbortSignal.any([job.signal, AbortSignal.timeout(240000)]),
          );
        else if (task.kind === 'stars')
          await syncStarred(
            task.user_id,
            undefined,
            AbortSignal.any([job.signal, AbortSignal.timeout(240000)]),
          );
        else if (task.kind === 'summary' || task.kind === 'translation')
          await runAi(task.user_id, task.target_id, task.kind);
        else throw new Error('该任务处理器尚未就绪');
        await getPool().query(
          "UPDATE jobs SET status='completed',error=NULL,updated_at=now() WHERE id=$1",
          [task.id],
        );
        logger.info({ job_id: task.id, kind: task.kind }, 'Task completed');
      } catch (error) {
        if (job.signal.aborted) throw error;
        const final =
          error instanceof AiError ||
          !['sync', 'stars'].includes(task.kind) ||
          (error instanceof GitHubError && [401, 404, 429].includes(error.status)) ||
          job.retryCount >= job.retryLimit;
        await getPool().query('UPDATE jobs SET status=$2,error=$3,updated_at=now() WHERE id=$1', [
          task.id,
          final ? 'failed' : 'pending',
          error instanceof Error ? error.message : '任务失败',
        ]);
        logger.warn({ job_id: task.id, kind: task.kind, final }, 'Task failed');
        throw error;
      }
    }
  },
);
let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    await getPool().query(
      "INSERT INTO system_state(key,value) VALUES('worker-heartbeat',$1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [JSON.stringify(new Date().toISOString())],
    );
    const { rows } = await getPool().query('SELECT user_id,data FROM subscriptions');
    for (const row of rows) {
      const sub = row.data as Subscription;
      if (!sub.enabled || sub.demo || (sub.retryAt && Date.parse(sub.retryAt) > Date.now()))
        continue;
      const key = `schedule:${row.user_id}:${sub.id}`;
      const previous = await getPool().query('SELECT value FROM system_state WHERE key=$1', [key]);
      const interval =
        (sub.kind === 'repo'
          ? config.SYNC_REPO_INTERVAL_MINUTES
          : config.SYNC_AUTHOR_INTERVAL_MINUTES) * 60000;
      if (previous.rows[0] && Date.now() - Date.parse(previous.rows[0].value) < interval) continue;
      await enqueue(row.user_id, 'sync', sub.id);
      await getPool().query(
        'INSERT INTO system_state(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        [key, JSON.stringify(new Date().toISOString())],
      );
    }
    await reconcileJobs(boss);
    await scheduleStarSync();
    await publishPending(boss);
  } finally {
    ticking = false;
  }
}
await tick();
const timer = setInterval(
  () => tick().catch((error) => logger.error({ error: error.name }, 'Scheduler failed')),
  3000,
);
logger.info('Worker ready');
let refreshingTrending = false;
async function refreshTrending() {
  if (refreshingTrending || config.APP_MODE !== 'live') return;
  refreshingTrending = true;
  try {
    await getTrending();
  } catch {
    logger.warn('Trending snapshot refresh failed');
  } finally {
    refreshingTrending = false;
  }
}
void refreshTrending();
const trendingTimer = setInterval(() => void refreshTrending(), 60000);
async function stop() {
  clearInterval(timer);
  clearInterval(trendingTimer);
  await boss.stop();
  await getPool().end();
  process.exit(0);
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
