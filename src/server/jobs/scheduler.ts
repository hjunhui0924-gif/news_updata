import { getPool } from '../db/client';
import { enqueue } from './queue';
import { syncIntervalMinutes } from '../platforms/registry';
import type { Subscription } from '@/shared/types';

export async function scheduleSubscriptions(now = Date.now()) {
  // One scan instead of one state query per source. Oldest scheduled work gets the next turn.
  const { rows } = await getPool().query(
    `SELECT s.user_id,s.data,t.value AS scheduled_at
     FROM subscriptions s LEFT JOIN system_state t ON t.key='schedule:'||s.user_id||':'||s.id
     WHERE (s.data->>'enabled')::boolean AND NOT COALESCE((s.data->>'demo')::boolean,false)
     ORDER BY t.value NULLS FIRST,s.id`,
  );
  let scheduled = 0;
  for (const row of rows) {
    const sub = row.data as Subscription;
    if (sub.retryAt && Date.parse(sub.retryAt) > now) continue;
    if (row.scheduled_at && now - Date.parse(row.scheduled_at) < syncIntervalMinutes(sub) * 60000)
      continue;
    await enqueue(row.user_id, 'sync', sub.id);
    await getPool().query(
      'INSERT INTO system_state(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      [`schedule:${row.user_id}:${sub.id}`, JSON.stringify(new Date(now).toISOString())],
    );
    if (++scheduled === 50) break;
  }
  return scheduled;
}
