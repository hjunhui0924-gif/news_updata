import { transaction } from '../db/client';
import { fetchTrending, trendingUrl } from '../connectors/trending';
import type { TrendingSnapshot } from '@/shared/trending';

export const TRENDING_TTL = 24 * 60 * 60 * 1000;
const RETRY_DELAY = 15 * 60 * 1000;

export async function getTrending(
  language = '',
  fetcher = fetchTrending,
  now = Date.now(),
): Promise<TrendingSnapshot> {
  const sourceUrl = trendingUrl(language);
  const key = `trending:daily:${language || 'all'}`;
  return transaction(async (client) => {
    const read = async () =>
      (await client.query('SELECT value FROM system_state WHERE key=$1', [key])).rows[0]?.value as
        TrendingSnapshot | undefined;
    const fresh = (snapshot: TrendingSnapshot | undefined) =>
      snapshot?.fetchedAt && now - Date.parse(snapshot.fetchedAt) < TRENDING_TTL;
    const waiting = (snapshot: TrendingSnapshot | undefined) =>
      snapshot?.retryAt && now < Date.parse(snapshot.retryAt);
    let snapshot = await read();
    if (fresh(snapshot)) return { ...snapshot!, stale: false };
    if (waiting(snapshot)) return { ...snapshot!, stale: true };
    const lock = await client.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) locked', [key]);
    if (!lock.rows[0].locked)
      return {
        repositories: snapshot?.repositories ?? [],
        fetchedAt: snapshot?.fetchedAt ?? null,
        sourceUrl,
        language,
        stale: true,
        error: '榜单正在刷新，请稍后刷新查看。',
        retryAt: null,
      };
    snapshot = await read();
    if (fresh(snapshot)) return { ...snapshot!, stale: false };
    if (waiting(snapshot)) return { ...snapshot!, stale: true };
    let result: TrendingSnapshot;
    try {
      const repositories = await fetcher(language);
      result = {
        repositories,
        fetchedAt: new Date(now).toISOString(),
        sourceUrl,
        language,
        stale: false,
        error: null,
        retryAt: null,
      };
    } catch {
      result = {
        repositories: snapshot?.repositories ?? [],
        fetchedAt: snapshot?.fetchedAt ?? null,
        sourceUrl,
        language,
        stale: true,
        error: 'Trending 获取失败。已有榜单保留供阅读，15 分钟后可重试。',
        retryAt: new Date(now + RETRY_DELAY).toISOString(),
      };
    }
    await client.query(
      'INSERT INTO system_state(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      [key, JSON.stringify(result)],
    );
    return result;
  });
}
