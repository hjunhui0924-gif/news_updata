import { transaction } from './client';

const marker = 'maintenance:ephemeral:last';
const interval = 60 * 60 * 1000;
const batchSize = 1000;

// Expiration only: never delete content, connections, jobs, reading state or AI accounting.
export async function cleanupEphemeralState(now = Date.now()) {
  return transaction(async (client) => {
    const lock = await client.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired', [
      marker,
    ]);
    if (!lock.rows[0].acquired) return 0;
    const previous = await client.query('SELECT value FROM system_state WHERE key=$1', [marker]);
    const last = previous.rows[0]?.value;
    if (typeof last === 'number' && now - last < interval) return 0;
    const result = await client.query(
      `WITH expired AS (
      SELECT key FROM system_state
      WHERE CASE
        WHEN key LIKE 'youtube-oauth:%' OR key LIKE 'youtube-follow-preview:%' THEN
          CASE WHEN jsonb_typeof(value->'expiresAt')='number'
            THEN (value->>'expiresAt')::numeric <= $1 ELSE false END
        WHEN key LIKE 'youtube:quota:%' THEN
          CASE WHEN jsonb_typeof(value)='number'
            THEN (value #>> '{}')::numeric <= $1 ELSE false END
        ELSE false END
      ORDER BY key LIMIT $2 FOR UPDATE SKIP LOCKED
    ) DELETE FROM system_state s USING expired e WHERE s.key=e.key`,
      [now, batchSize],
    );
    const deleted = result.rowCount ?? 0;
    // A full batch may have more work; the next scheduler turn can continue draining.
    if (deleted < batchSize) {
      await client.query(
        'INSERT INTO system_state(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        [marker, JSON.stringify(now)],
      );
    }
    return deleted;
  });
}
