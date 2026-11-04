import type { PgBoss, JobWithMetadata } from 'pg-boss';
import { QUEUE, TASK_PRIORITIES } from './queue';

export type TaskDelivery = JobWithMetadata<{ id: string }>;

export async function workTaskLanes(
  boss: PgBoss,
  handler: (jobs: TaskDelivery[]) => Promise<void>,
) {
  for (const priority of TASK_PRIORITIES) {
    await boss.work(
      QUEUE,
      {
        includeMetadata: true,
        pollingIntervalSeconds: 0.5,
        minPriority: priority,
        maxPriority: priority,
        localConcurrency: 1,
        batchSize: 1,
      },
      handler,
    );
  }
}
