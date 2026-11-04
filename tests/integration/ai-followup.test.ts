import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getPool, transaction } from '../../src/server/db/client';
import { migrate } from '../../scripts/migrate';
import { persistUpdates } from '../../src/server/subscriptions/ingest';
import { createDemoData } from '../../src/server/demo/fixtures';
import { runAi } from '../../src/server/ai/service';
import { finishTask } from '../../src/server/jobs/completion';

const user = `followup-${randomUUID()}`;
const item = {
  ...createDemoData().items[0],
  id: randomUUID(),
  externalId: randomUUID(),
  demo: false,
  summary: null,
  aiStatus: 'pending' as const,
  contentHash: randomUUID(),
};
beforeAll(async () => {
  for (const [key, value] of Object.entries({
    APP_MODE: 'demo',
    LLM_ENABLED: 'true',
    LLM_API_KEY: 'test',
    LLM_MODEL: 'followup',
    LLM_API_BASE_URL: 'https://fixture.invalid',
    LLM_INPUT_USD_PER_MILLION: '1',
    LLM_OUTPUT_USD_PER_MILLION: '1',
    LLM_DAILY_BUDGET_USD: '1',
    LLM_MONTHLY_BUDGET_USD: '5',
  }))
    vi.stubEnv(key, value);
  await migrate();
  await getPool().query('INSERT INTO app_users(id,name) VALUES($1,$2)', [user, 'test']);
});
afterAll(async () => {
  for (const table of ['jobs', 'items', 'ai_usage'])
    await getPool().query(`DELETE FROM ${table} WHERE user_id=$1`, [user]);
  await getPool().query('DELETE FROM system_state WHERE key LIKE $1', [
    `ai-summary-followup:${user}:%`,
  ]);
  await getPool().query('DELETE FROM app_users WHERE id=$1', [user]);
  await getPool().end();
  vi.unstubAllEnvs();
});
it('hands a changed body to one durable successor after the old paid request finishes', async () => {
  await transaction((client) => persistUpdates(client, user, [item]));
  const old = (await getPool().query('SELECT id FROM jobs WHERE user_id=$1', [user])).rows[0].id;
  await getPool().query("UPDATE jobs SET status='running' WHERE id=$1", [old]);
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  const model = vi.fn(async () => {
    started();
    await gate;
    return {
      value: {
        headline: '标题',
        overview: '说明',
        changes: [{ text: '变化', evidenceIds: ['s1'] }],
        impact: { text: '未知', kind: 'unknown', evidenceIds: [] },
        breakingChange: 'unknown',
        breakingEvidenceIds: [],
        migrationNote: null,
        migrationEvidenceIds: [],
      },
      inputTokens: 10,
      outputTokens: 20,
    };
  });
  const result = runAi(user, item.id, 'summary', model).catch((error) => error);
  await running;
  try {
    await transaction((client) =>
      persistUpdates(client, user, [
        { ...item, contentHash: `${item.contentHash}-new`, body: 'Changed source body.' },
      ]),
    );
    expect(
      (
        await getPool().query(
          "SELECT id FROM jobs WHERE user_id=$1 AND status IN ('running','pending')",
          [user],
        )
      ).rows,
    ).toHaveLength(1);
  } finally {
    release();
  }
  expect((await result).message).toContain('原文已更新');
  await finishTask(old, 'failed', '原文已更新');
  await finishTask(old, 'failed', '重复完成通知');
  const pending = await getPool().query(
    "SELECT id FROM jobs WHERE user_id=$1 AND status='pending'",
    [user],
  );
  expect(pending.rows).toHaveLength(1);
  expect(pending.rows[0].id).not.toBe(old);
  expect(model).toHaveBeenCalledTimes(1);
  await runAi(user, item.id, 'summary', model);
  await finishTask(pending.rows[0].id, 'completed', null);
  expect(
    (
      await getPool().query(
        "SELECT id FROM jobs WHERE user_id=$1 AND status IN ('running','pending')",
        [user],
      )
    ).rows,
  ).toHaveLength(0);
  const usage = await getPool().query('SELECT status FROM ai_usage WHERE user_id=$1', [user]);
  expect(usage.rows).toHaveLength(2);
  expect(usage.rows.every((row) => row.status === 'settled')).toBe(true);
});

it('does not automatically rebill a version already taken over before a worker interruption', async () => {
  const next = { ...item, id: randomUUID(), externalId: randomUUID(), contentHash: randomUUID() };
  await transaction((client) => persistUpdates(client, user, [next]));
  const job = (
    await getPool().query('SELECT id FROM jobs WHERE user_id=$1 AND target_id=$2', [user, next.id])
  ).rows[0].id;
  await transaction((client) =>
    persistUpdates(client, user, [
      { ...next, contentHash: `${next.contentHash}-new`, body: 'Changed before the model starts.' },
    ]),
  );
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  const model = vi.fn(async () => {
    started();
    await gate;
    throw new Error('simulated interruption');
  });
  const result = runAi(user, next.id, 'summary', model).catch((error) => error);
  await running;
  try {
    await finishTask(job, 'failed', 'Worker 中断，费用待核对');
    expect(
      (
        await getPool().query(
          "SELECT id FROM jobs WHERE user_id=$1 AND target_id=$2 AND status='pending'",
          [user, next.id],
        )
      ).rows,
    ).toHaveLength(0);
  } finally {
    release();
  }
  await result;
  expect(model).toHaveBeenCalledTimes(1);
});
