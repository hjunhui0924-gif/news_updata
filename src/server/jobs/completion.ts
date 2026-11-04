import { randomUUID } from 'node:crypto';
import { transaction } from '../db/client';

export const summaryFollowupKey = (user: string, item: string) =>
  `ai-summary-followup:${user}:${item}`;

export async function claimSummaryVersion(user: string, item: string, hash: string) {
  return transaction(async (client) => {
    const current = (
      await client.query(
        "SELECT data->>'contentHash' AS hash FROM items WHERE user_id=$1 AND id=$2 FOR UPDATE",
        [user, item],
      )
    ).rows[0];
    if (current?.hash !== hash) return false;
    await client.query('DELETE FROM system_state WHERE key=$1 AND value=$2::jsonb', [
      summaryFollowupKey(user, item),
      JSON.stringify(hash),
    ]);
    return true;
  });
}

export async function finishTask(id: string, status: 'completed' | 'failed', error: string | null) {
  await transaction(async (client) => {
    const task = (await client.query('SELECT user_id,kind,target_id FROM jobs WHERE id=$1', [id]))
      .rows[0];
    if (!task) return;
    // Ingestion locks the item before creating a job. Keep that same order here.
    const item =
      task.kind === 'summary'
        ? (
            await client.query('SELECT data FROM items WHERE user_id=$1 AND id=$2 FOR UPDATE', [
              task.user_id,
              task.target_id,
            ])
          ).rows[0]?.data
        : undefined;
    const updated = await client.query(
      "UPDATE jobs SET status=$2,error=$3,updated_at=now() WHERE id=$1 AND status IN ('pending','running') RETURNING id",
      [id, status, error],
    );
    if (!updated.rowCount || task.kind !== 'summary') return;
    const key = summaryFollowupKey(task.user_id, task.target_id);
    const intent = (await client.query('SELECT value FROM system_state WHERE key=$1', [key]))
      .rows[0]?.value;
    if (item?.aiStatus === 'pending' && intent === item.contentHash) {
      const queued = await client.query(
        "INSERT INTO jobs(id,user_id,kind,target_id) VALUES($1,$2,'summary',$3) ON CONFLICT DO NOTHING",
        [randomUUID(), task.user_id, task.target_id],
      );
      if (queued.rowCount) await client.query('DELETE FROM system_state WHERE key=$1', [key]);
    } else {
      await client.query('DELETE FROM system_state WHERE key=$1', [key]);
    }
  });
}
