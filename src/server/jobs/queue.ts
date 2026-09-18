import { PgBoss } from 'pg-boss';
import { getConfig } from '../config';
import { getPool, transaction } from '../db/client';
import type { Job, JobKind } from '@/shared/types';
import { randomUUID } from 'node:crypto';

export const QUEUE = 'news-tasks';
export async function createBoss() {
  const boss = new PgBoss({ connectionString: getConfig().DATABASE_URL, schema: 'pgboss' });
  boss.on('error', (error) => console.error('Queue error:', error.message));
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

export async function publishPending(boss: PgBoss) {
  await transaction(async (client) => {
    const { rows } = await client.query(
      "SELECT id FROM jobs WHERE status='pending' AND enqueued_at IS NULL ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED",
    );
    for (const row of rows) {
      await boss.send(
        QUEUE,
        { id: row.id },
        {
          id: row.id,
          singletonKey: row.id,
          db: { executeSql: (sql, values) => client.query(sql, values) },
        },
      );
      await client.query('UPDATE jobs SET enqueued_at=now() WHERE id=$1', [row.id]);
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
    const interrupted = missing || (delivery && ['failed', 'cancelled', 'completed'].includes(delivery.state));
    if (interrupted && ['sync', 'stars'].includes(row.kind)) {
      if (delivery) await boss.deleteJob(QUEUE, row.id);
      await getPool().query(
        "UPDATE jobs SET status='pending',enqueued_at=NULL,error=$2,updated_at=now() WHERE id=$1 AND status IN ('pending','running')",
        [row.id, '后台任务中断，已自动重新排队。'],
      );
    } else if (interrupted) {
      await getPool().query(
        "UPDATE jobs SET status='failed',error=$2,updated_at=now() WHERE id=$1 AND status IN ('pending','running')",
        [row.id, '后台任务中断或超时，请重新同步或生成。'],
      );
    }
  }
}
