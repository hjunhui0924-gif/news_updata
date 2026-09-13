import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getPool } from '../../src/server/db/client';
import { migrate } from '../../scripts/migrate';
import { getTrending, TRENDING_TTL } from '../../src/server/discovery/service';
import {
  translateDescription,
  descriptionCacheKey,
  withChineseDescriptions,
} from '../../src/server/discovery/translation';
import type { TrendingRepository } from '../../src/shared/trending';

const userId = `test-trending-${randomUUID()}`;
const repo: TrendingRepository = {
  name: `${userId}/example`,
  rank: 1,
  description: 'Build useful developer tools.',
  url: `https://github.com/${userId}/example`,
  language: 'Rust',
  stars: 12,
  starsToday: 3,
};
const keys = ['rust', 'go', 'swift'].map((lang) => `trending:daily:${lang}`);
const now = Date.now();
const cacheKeys: string[] = [];
beforeAll(async () => {
  vi.stubEnv('LLM_ENABLED', 'true');
  vi.stubEnv('LLM_MODEL', 'test-model');
  vi.stubEnv('LLM_API_KEY', 'test-only');
  vi.stubEnv('LLM_API_BASE_URL', 'https://fixture.invalid/v1');
  vi.stubEnv('LLM_INPUT_USD_PER_MILLION', '1');
  vi.stubEnv('LLM_OUTPUT_USD_PER_MILLION', '1');
  await migrate();
  await getPool().query('DELETE FROM system_state WHERE key=ANY($1::text[])', [keys]);
  await getPool().query('INSERT INTO app_users(id,name) VALUES($1,$2)', [userId, 'trending-test']);
});
afterAll(async () => {
  await getPool().query('DELETE FROM system_state WHERE key=ANY($1::text[])', [keys]);
  await getPool().query('DELETE FROM ai_cache WHERE key=ANY($1::text[])', [cacheKeys]);
  await getPool().query('DELETE FROM ai_usage WHERE user_id=$1', [userId]);
  await getPool().query('DELETE FROM app_users WHERE id=$1', [userId]);
  await getPool().end();
  vi.unstubAllEnvs();
});
it('persists a daily snapshot, reuses it, preserves it on failure and retries after cooldown', async () => {
  const fetcher = vi.fn(async () => [repo]);
  const first = await getTrending('rust', fetcher, now);
  expect(first.stale).toBe(false);
  expect((await getTrending('rust', fetcher, now + 1000)).fetchedAt).toBe(first.fetchedAt);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const failed = vi.fn(async () => {
    throw new Error('offline');
  });
  const stale = await getTrending('rust', failed, now + TRENDING_TTL);
  expect(stale).toMatchObject({ stale: true, repositories: [repo], fetchedAt: first.fetchedAt });
  expect(stale.error).toBeTruthy();
  await getTrending('rust', failed, now + TRENDING_TTL + 1000);
  expect(failed).toHaveBeenCalledTimes(1);
  const recovered = await getTrending('rust', fetcher, Date.parse(stale.retryAt!));
  expect(recovered).toMatchObject({ stale: false, error: null, retryAt: null });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('initial failure is explicit and language snapshots are isolated', async () => {
  const empty = await getTrending(
    'go',
    async () => {
      throw new Error('offline');
    },
    now,
  );
  expect(empty.repositories).toEqual([]);
  expect(empty.fetchedAt).toBeNull();
  expect(empty.error).toBeTruthy();
  const swift = await getTrending('swift', async () => [{ ...repo, language: 'Swift' }], now);
  expect(swift.repositories[0].language).toBe('Swift');
});
it('collapses concurrent snapshot fetches across callers', async () => {
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  const fetcher = vi.fn(async () => {
    started();
    await gate;
    return [repo];
  });
  const first = getTrending('go', fetcher, now + TRENDING_TTL * 2);
  await running;
  const second = await getTrending('go', fetcher, now + TRENDING_TTL * 2);
  release();
  await first;
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(second.error).toContain('正在刷新');
});
it('validates Chinese descriptions, reuses cache, and invalidates it when the description changes', async () => {
  cacheKeys.push(descriptionCacheKey(repo));
  const invalid = vi.fn(async () => ({
    value: { segments: [{ id: 'l0', text: 'Build useful developer tools.' }] },
  }));
  await expect(translateDescription(userId, repo, invalid)).rejects.toThrow('完整性');
  expect((await withChineseDescriptions([repo]))[0].chineseDescription).toBeNull();
  const valid = vi.fn(async () => ({
    value: { segments: [{ id: 'l0', text: '构建实用的开发工具。' }] },
    inputTokens: 10,
    outputTokens: 10,
  }));
  await translateDescription(userId, repo, valid);
  vi.stubEnv('LLM_ENABLED', 'false');
  expect(await translateDescription(userId, repo, valid)).toBe('构建实用的开发工具。');
  expect(valid).toHaveBeenCalledTimes(1);
  expect((await withChineseDescriptions([repo]))[0].chineseDescription).toBe(
    '构建实用的开发工具。',
  );
  const changed = { ...repo, description: 'A different description.' };
  expect((await withChineseDescriptions([changed]))[0].chineseDescription).toBeNull();
  await expect(translateDescription(userId, changed, valid)).rejects.toThrow('关闭');
  vi.stubEnv('LLM_ENABLED', 'true');
});
it('prevents duplicate concurrent billable translations and enforces the budget', async () => {
  const current = { ...repo, description: 'Concurrent translation request.' };
  cacheKeys.push(descriptionCacheKey(current));
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
    return { value: { segments: [{ id: 'l0', text: '并发翻译请求。' }] } };
  });
  const first = translateDescription(userId, current, model);
  await running;
  await expect(translateDescription(userId, current, model)).rejects.toThrow('正在翻译');
  release();
  await first;
  expect(model).toHaveBeenCalledTimes(1);
  vi.stubEnv('LLM_DAILY_BUDGET_USD', '0.00001');
  await expect(
    translateDescription(userId, { ...repo, description: 'Budget limited request.' }, model),
  ).rejects.toThrow('预算');
  expect(model).toHaveBeenCalledTimes(1);
});
