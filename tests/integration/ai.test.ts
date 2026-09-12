import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getPool } from '../../src/server/db/client';
import { saveItem, getItem } from '../../src/server/db/store';
import { migrate } from '../../scripts/migrate';
import { runAi, reserveBudget } from '../../src/server/ai/service';
import { createDemoData } from '../../src/server/demo/fixtures';
const userId = `test-ai-${randomUUID()}`;
const item = {
  ...createDemoData().items[0],
  id: randomUUID(),
  externalId: randomUUID(),
  demo: false,
  summary: null,
  contentHash: randomUUID(),
};
const valid = {
  headline: '示例',
  overview: '测试摘要',
  changes: [{ text: '来自原文的说明', evidenceIds: ['s1'] }],
  impact: { text: '未知', kind: 'unknown', evidenceIds: [] },
  breakingChange: 'unknown',
  breakingEvidenceIds: [],
  migrationNote: null,
  migrationEvidenceIds: [],
};
beforeAll(async () => {
  for (const [key, value] of Object.entries({
    APP_MODE: 'demo',
    LLM_ENABLED: 'true',
    LLM_API_KEY: 'test-only',
    LLM_MODEL: 'fixture',
    LLM_API_BASE_URL: 'https://fixture.invalid/v1',
    LLM_INPUT_USD_PER_MILLION: '1',
    LLM_OUTPUT_USD_PER_MILLION: '1',
    LLM_DAILY_BUDGET_USD: '0.5',
    LLM_MONTHLY_BUDGET_USD: '5',
  }))
    vi.stubEnv(key, value);
  await migrate();
  await getPool().query('INSERT INTO app_users(id,name) VALUES($1,$2)', [userId, 'test']);
  await saveItem(userId, item);
});
afterAll(async () => {
  await getPool().query('DELETE FROM ai_usage WHERE user_id=$1', [userId]);
  await getPool().query('DELETE FROM items WHERE user_id=$1', [userId]);
  await getPool().query('DELETE FROM app_users WHERE id=$1', [userId]);
  await getPool().end();
  vi.unstubAllEnvs();
});
it('caches successful results and never overwrites changed source content', async () => {
  let calls = 0;
  const model = async () => {
    calls++;
    return { value: valid, inputTokens: 20, outputTokens: 30 };
  };
  await runAi(userId, item.id, 'summary', model);
  await runAi(userId, item.id, 'summary', model);
  expect(calls).toBe(1);
  expect((await getItem(userId, item.id))?.summary?.overview).toBe('测试摘要');
  await saveItem(userId, { ...item, contentHash: `${userId}:revision-2` });
  await expect(
    runAi(userId, item.id, 'summary', async () => {
      await saveItem(userId, { ...item, contentHash: `${userId}:revision-3` });
      return { value: valid };
    }),
  ).rejects.toThrow('原文已更新');
  expect((await getItem(userId, item.id))?.summary).toBeNull();
});
it('concurrent reservations cannot exceed the configured daily budget', async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () => reserveBudget(userId, 0.2)),
  );
  expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(2);
  expect(results.filter((x) => x.status === 'rejected')).toHaveLength(3);
});

it('budget rejection becomes visible while preserving the original', async () => {
  vi.stubEnv('LLM_DAILY_BUDGET_USD', '0.001');
  await saveItem(userId, { ...item, contentHash: randomUUID(), aiStatus: 'pending' });
  await expect(
    runAi(userId, item.id, 'summary', async () => {
      throw new Error('must not call provider');
    }),
  ).rejects.toThrow('预算');
  const current = await getItem(userId, item.id);
  expect(current?.aiStatus).toBe('failed');
  expect(current?.aiError).toContain('预算');
  expect(current?.body).toBe(item.body);
});
