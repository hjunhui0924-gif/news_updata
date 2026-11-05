import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PgBoss } from 'pg-boss';
import { migrate } from '../../scripts/migrate';
import { getPool } from '../../src/server/db/client';
import { publishPending } from '../../src/server/jobs/queue';

const prefix = `turn-${randomUUID()}`;
const users = Array.from({ length: 17 }, (_, i) => `${prefix}-${String(i).padStart(2, '0')}`);
beforeAll(async () => {
  await migrate();
  for (const [index, user] of users.entries()) {
    await getPool().query('INSERT INTO app_users(id,name) VALUES($1,$1)', [user]);
    for (let j = 0; j < (index === 16 ? 1 : 3); j++)
      await getPool().query(
        "INSERT INTO jobs(id,user_id,kind,target_id,created_at) VALUES($1,$2,'translation',$3,$4)",
        [randomUUID(), user, `${user}-${j}`, index === 16 ? '2026-01-01' : '2020-01-01'],
      );
  }
});
afterAll(async () => {
  await getPool().query('DELETE FROM jobs WHERE user_id=ANY($1::text[])', [users]);
  await getPool().query('DELETE FROM system_state WHERE key LIKE $1', [`queue-turn:${prefix}%`]);
  await getPool().query('DELETE FROM app_users WHERE id=ANY($1::text[])', [users]);
  await getPool().end();
});
it('gives the seventeenth user a turn across batches despite older backlogs for sixteen users', async () => {
  const send: PgBoss['send'] = async () => randomUUID();
  await publishPending({ send });
  expect(
    (
      await getPool().query('SELECT 1 FROM jobs WHERE user_id=$1 AND enqueued_at IS NOT NULL', [
        users[16],
      ])
    ).rowCount,
  ).toBe(0);
  await publishPending({ send });
  expect(
    (
      await getPool().query('SELECT 1 FROM jobs WHERE user_id=$1 AND enqueued_at IS NOT NULL', [
        users[16],
      ])
    ).rowCount,
  ).toBe(1);
  expect(
    (
      await getPool().query('SELECT 1 FROM system_state WHERE key=$1', [
        `queue-turn:${users[16]}:ai`,
      ])
    ).rowCount,
  ).toBe(1);
});
