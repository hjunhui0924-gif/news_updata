import { PgBoss } from 'pg-boss';
import { getConfig } from '../config';
import { getPool, transaction } from '../db/client';
import type { Job, JobKind } from '@/shared/types';
import { randomUUID } from 'node:crypto';
import { finishTask } from './completion';

export const QUEUE = 'news-tasks';
// Separate reserved consumers share one durable queue, so pre-upgrade deliveries remain valid.
export const TASK_PRIORITIES = [0, 1, 2] as const;
export function taskPriority(kind: JobKind, platform: string) {
  return kind === 'stars' || (kind === 'sync' && platform !== 'youtube')
    ? 1
    : kind === 'sync'
      ? 2
      : 0;
}
export async function createBoss(schema = 'pgboss') {
  const boss = new PgBoss({ connectionString: getConfig().DATABASE_URL, schema });
  boss.on('error', () => console.error('Queue error: database operation unavailable'));
  await boss.start();
  await boss.createQueue(QUEUE, {
    retryLimit: 2,
    retryDelay: 15,
    retryBackoff: true,
    expireInSeconds: 300,
  });
  return boss;
}

export async function enqueue(userId: string, kind: JobKind, targetId: string): Promise<Job> {
  return transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `job:${userId}:${kind}:${targetId}`,
    ]);
    const existing = await client.query(
      "SELECT * FROM jobs WHERE user_id=$1 AND kind=$2 AND target_id=$3 AND status IN ('pending','running')",
      [userId, kind, targetId],
    );
    const row =
      existing.rows[0] ??
      (
        await client.query(
          'INSERT INTO jobs(id,user_id,kind,target_id) VALUES($1,$2,$3,$4) RETURNING *',
          [randomUUID(), userId, kind, targetId],
        )
      ).rows[0];
    return mapJob(row);
  });
}

export function mapJob(row: Record<string, unknown>): Job {
  return {
    id: String(row.id),
    kind: row.kind as JobKind,
    targetId: String(row.target_id),
    status: row.status as Job['status'],
    error: row.error as string | null,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

export async function publishPending(boss: Pick<PgBoss, 'send'>) {
  await transaction(async (client) => {
    const { rows } = await client.query(
      `WITH user_turns AS (
         SELECT j.id,COALESCE(s.platform,'github') AS platform,
           row_number() OVER (
             PARTITION BY CASE WHEN j.kind='stars' THEN 'github'
               WHEN j.kind='sync' THEN COALESCE(s.platform,'github') ELSE 'ai' END,j.user_id
             ORDER BY j.created_at,j.id
           ) AS user_position,
           CASE WHEN j.kind='stars' THEN 'github'
             WHEN j.kind='sync' THEN COALESCE(s.platform,'github') ELSE 'ai' END AS lane,
           j.created_at,turn.value AS last_served
         FROM jobs j LEFT JOIN subscriptions s ON j.kind='sync' AND s.id=j.target_id AND s.user_id=j.user_id
         LEFT JOIN system_state turn ON turn.key='queue-turn:'||j.user_id||':'||
           CASE WHEN j.kind='stars' THEN 'github' WHEN j.kind='sync' THEN COALESCE(s.platform,'github') ELSE 'ai' END
         WHERE j.status='pending' AND j.enqueued_at IS NULL
       ), candidates AS (
         SELECT *,row_number() OVER (PARTITION BY lane ORDER BY user_position,last_served NULLS FIRST,created_at,id) AS position
         FROM user_turns
       )
       SELECT j.id,j.user_id,j.kind,c.platform,c.lane FROM jobs j JOIN candidates c ON c.id=j.id
       WHERE c.position<=16 ORDER BY j.created_at,j.id FOR UPDATE OF j SKIP LOCKED`,
    );
    for (const row of rows) {
      await boss.send(
        QUEUE,
        { id: row.id },
        {
          id: row.id,
          singletonKey: row.id,
          priority: taskPriority(row.kind, row.platform),
          db: { executeSql: (sql, values) => client.query(sql, values) },
        },
      );
      await client.query('UPDATE jobs SET enqueued_at=now() WHERE id=$1', [row.id]);
      await client.query(
        'INSERT INTO system_state(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        [`queue-turn:${row.user_id}:${row.lane}`, JSON.stringify(new Date().toISOString())],
      );
    }
  });
}

export async function reconcileJobs(boss: PgBoss) {
  const { rows } = await getPool().query(
    "SELECT id,kind,enqueued_at FROM jobs WHERE status IN ('pending','running') AND enqueued_at IS NOT NULL ORDER BY updated_at LIMIT 100",
  );
  for (const row of rows) {
    const delivery = await boss.getJobById(QUEUE, row.id);
    const missing = !delivery && Date.now() - new Date(row.enqueued_at).getTime() > 600000;
    const interrupted =
      missing || (delivery && ['failed', 'cancelled', 'completed'].includes(delivery.state));
    if (interrupted && ['sync', 'stars'].includes(row.kind)) {
      if (delivery) await boss.deleteJob(QUEUE, row.id);
      await getPool().query(
        "UPDATE jobs SET status='pending',enqueued_at=NULL,error=$2,updated_at=now() WHERE id=$1 AND status IN ('pending','running')",
        [row.id, '后台任务中断，已自动重新排队。'],
      );
    } else if (interrupted) {
      await finishTask(row.id, 'failed', '后台任务中断或超时，请重新同步或生成。');
    }
  }
}
