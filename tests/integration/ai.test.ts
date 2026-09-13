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
it('does not save or cache a partial translation, and caches a complete retry', async () => {
  const source =
    '### Changes\n\n- Fix expired login sessions and improve the error message.\n- Cache static assets to improve initial loading speed.\n- Add Korean documentation with navigation and search support for new users.\n';
  const translated =
    '### 变化\n\n- 修复过期登录会话并改进错误提示。\n- 缓存静态资源以提升初始加载速度。\n- 为新用户添加支持导航和搜索的韩文文档。\n';
  const current = {
    ...item,
    id: randomUUID(),
    externalId: randomUUID(),
    contentHash: randomUUID(),
    language: 'en' as const,
    body: source,
    translation: null,
  };
  await saveItem(userId, current);
  await expect(
    runAi(userId, current.id, 'translation', async () => ({
      value: { segments: [{ id: 'l0', text: '变化' }] },
      inputTokens: 20,
      outputTokens: 10,
    })),
  ).rejects.toThrow('不完整');
  expect((await getItem(userId, current.id))?.translation).toBeNull();
  let calls = 0;
  const complete = async () => {
    calls++;
    return {
      value: {
        segments: [
          { id: 'l0', text: '变化' },
          { id: 'l2', text: '修复过期登录会话并改进错误提示。' },
          { id: 'l3', text: '缓存静态资源以提升初始加载速度。' },
          { id: 'l4', text: '为新用户添加支持导航和搜索的韩文文档。' },
        ],
      },
      inputTokens: 20,
      outputTokens: 80,
    };
  };
  await runAi(userId, current.id, 'translation', complete);
  await runAi(userId, current.id, 'translation', complete);
  expect(calls).toBe(1);
  expect((await getItem(userId, current.id))?.translation).toBe(translated);
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
