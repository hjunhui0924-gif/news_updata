import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { migrate } from '../../scripts/migrate';
import { getPool } from '../../src/server/db/client';
import { cleanupEphemeralState } from '../../src/server/db/ephemeral-cleanup';
import { createDemoData } from '../../src/server/demo/fixtures';
import { saveItem, getItem } from '../../src/server/db/store';

const tag = `cleanup-${randomUUID()}`;
const now = Date.now();
const marker = 'maintenance:ephemeral:last';
const entries = [
  [`youtube-oauth:${tag}:old`, { userId: tag, expiresAt: now - 1, verifier: 'fixture-only' }],
  [`youtube-follow-preview:${tag}:old`, { expiresAt: now - 1 }],
  [`youtube:quota:${tag}:old`, now - 1],
  [`youtube-oauth:${tag}:active`, { expiresAt: now + 86400000 }],
  [`youtube-follow-preview:${tag}:active`, { expiresAt: now + 86400000 }],
  [`youtube:quota:${tag}:active`, now + 86400000],
  [`youtube-oauth:${tag}:malformed`, { expiresAt: 'not-a-time' }],
  [`youtube:quota:${tag}:malformed`, { value: now - 1 }],
  [`unrelated:${tag}`, { expiresAt: now - 1 }],
] as const;
const item = { ...createDemoData().items[0], id: tag, externalId: tag, read: true, saved: true };
beforeAll(async () => {
  await migrate();
  await getPool().query('INSERT INTO app_users(id,name) VALUES($1,$2)', [tag, 'test']);
  await saveItem(tag, item);
  await getPool().query('DELETE FROM system_state WHERE key=$1', [marker]);
  for (const [key, value] of entries) {
    await getPool().query('INSERT INTO system_state(key,value) VALUES($1,$2)', [
      key,
      JSON.stringify(value),
    ]);
  }
});
afterAll(async () => {
  await getPool().query('DELETE FROM system_state WHERE key LIKE $1 OR key=$2', [
    `%${tag}%`,
    marker,
  ]);
  await getPool().query('DELETE FROM items WHERE user_id=$1', [tag]);
  await getPool().query('DELETE FROM app_users WHERE id=$1', [tag]);
  await getPool().end();
});

it('only removes expired typed ephemeral records, and preserves original, saved and read state', async () => {
  await cleanupEphemeralState(now);
  const remaining = (
    await getPool().query('SELECT key FROM system_state WHERE key=ANY($1::text[]) ORDER BY key', [
      entries.map(([key]) => key),
    ])
  ).rows.map((row) => row.key);
  expect(remaining).toEqual(
    entries
      .slice(3)
      .map(([key]) => key)
      .sort(),
  );
  expect(await cleanupEphemeralState(now + 1)).toBe(0);
  expect(await getItem(tag, item.id)).toMatchObject({ body: item.body, read: true, saved: true });
});

it('bounds each batch, drains backlog, and persists the hourly throttle across invocations', async () => {
  await getPool().query('DELETE FROM system_state WHERE key=$1', [marker]);
  await getPool().query(
    `INSERT INTO system_state(key,value)
    SELECT 'youtube:quota:'||$1||':batch:'||g, to_jsonb($2::bigint) FROM generate_series(1,1005) g`,
    [tag, now - 1],
  );
  expect(await cleanupEphemeralState(now)).toBe(1000);
  expect(await cleanupEphemeralState(now + 1)).toBe(5);
  expect(await cleanupEphemeralState(now + 2)).toBe(0);
  expect(
    (await getPool().query('SELECT value FROM system_state WHERE key=$1', [marker])).rows[0].value,
  ).toBe(now + 1);
});

it('skips a concurrently extended cooldown instead of waiting or deleting its new deadline', async () => {
  await getPool().query('DELETE FROM system_state WHERE key=$1', [marker]);
  const key = `youtube:quota:${tag}:racing`;
  await getPool().query('INSERT INTO system_state(key,value) VALUES($1,$2)', [
    key,
    JSON.stringify(now - 1),
  ]);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE system_state SET value=$2 WHERE key=$1', [
      key,
      JSON.stringify(now + 86400000),
    ]);
    await cleanupEphemeralState(now);
    await client.query('COMMIT');
    expect(
      (await getPool().query('SELECT value FROM system_state WHERE key=$1', [key])).rows[0].value,
    ).toBe(now + 86400000);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
