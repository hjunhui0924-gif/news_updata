import { getConfig } from '../server/config';
import { getPool } from '../server/db/client';
import { createBoss, publishPending, reconcileJobs } from '../server/jobs/queue';
import { workTaskLanes } from '../server/jobs/workers';
import { scheduleSubscriptions } from '../server/jobs/scheduler';
import { cleanupEphemeralState } from '../server/db/ephemeral-cleanup';
import { finishTask } from '../server/jobs/completion';
import { syncSubscription } from '../server/subscriptions/service';
import pino from 'pino';
import { runAi, AiError } from '../server/ai/service';
import { PlatformError } from '../server/platforms/contract';
import { scheduleStarSync, syncStarred } from '../server/subscriptions/star-sync';
import { getTrending } from '../server/discovery/service';
import { getUserSkillDetails } from '../server/skills/service';
import { runSkillAi } from '../server/skills/ai';

const config = getConfig();
const logger = pino({ level: config.LOG_LEVEL });
const boss = await createBoss();
await workTaskLanes(boss, async (jobs) => {
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
      else if (task.kind === 'skill-summary' || task.kind === 'skill-translation') {
        const detail = await getUserSkillDetails(task.user_id, task.target_id, job.signal);
        if (!detail) throw new AiError('Skill 不存在或已不可读取。');
        await runSkillAi(
          task.user_id,
          detail,
          task.kind === 'skill-summary' ? 'summary' : 'translation',
        );
      } else throw new Error('该任务处理器尚未就绪');
      await finishTask(task.id, 'completed', null);
      logger.info({ job_id: task.id, kind: task.kind }, 'Task completed');
    } catch (error) {
      if (job.signal.aborted) throw error;
      const final =
        error instanceof AiError ||
        !['sync', 'stars'].includes(task.kind) ||
        (error instanceof PlatformError && [401, 404, 429].includes(error.status)) ||
        job.retryCount >= job.retryLimit;
      const message = error instanceof Error ? error.message : '任务失败';
      if (final) await finishTask(task.id, 'failed', message);
      else
        await getPool().query(
          "UPDATE jobs SET status='pending',error=$2,updated_at=now() WHERE id=$1",
          [task.id, message],
        );
      logger.warn({ job_id: task.id, kind: task.kind, final }, 'Task failed');
      throw error;
    }
  }
});
let ticking = false;
let lastCleanupCheck = 0;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    await getPool().query(
      "INSERT INTO system_state(key,value) VALUES('worker-heartbeat',$1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [JSON.stringify(new Date().toISOString())],
    );
    await scheduleSubscriptions();
    await reconcileJobs(boss);
    await scheduleStarSync();
    await publishPending(boss);
    if (Date.now() - lastCleanupCheck >= 60000) {
      try {
        const deleted = await cleanupEphemeralState();
        if (deleted < 1000) lastCleanupCheck = Date.now();
      } catch {
        // Maintenance failures must not stop scheduling or expose sensitive state keys.
        lastCleanupCheck = Date.now();
        logger.warn('Ephemeral cleanup deferred');
      }
    }
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
