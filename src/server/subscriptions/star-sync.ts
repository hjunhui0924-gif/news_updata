import { randomUUID } from 'node:crypto';
import { getPool, transaction } from '../db/client';
import { getConfig } from '../config';
import { GitHubConnector, GitHubError } from '../connectors/github';
import { createUserGitHubConnector } from '../connectors/github-user';
import { persistSubscription } from './service';
import { enqueue } from '../jobs/queue';
import type { StarSyncStatus } from '@/shared/types';

type ScanData = {
  generation?: string;
  page: number;
  scanStartedAt: string | null;
  lastSyncAt: string | null;
  lastAdded: number;
  error: string | null;
  retryAt?: string | null;
};
async function accountIdFor(userId: string) {
  const { rows } = await getPool().query(
    'SELECT "accountId" FROM account WHERE "userId"=$1 AND "providerId"=$2',
    [userId, 'github'],
  );
  const id: string | undefined = rows[0]?.accountId;
  if (
    !id ||
    !getConfig()
      .ALLOWED_GITHUB_USER_IDS.split(',')
      .map((value) => value.trim())
      .includes(id)
  )
    throw new GitHubError('请使用允许访问的 GitHub 账号登录后开启自动跟踪。', 401);
  return id;
}
export async function getStarSync(userId: string): Promise<StarSyncStatus | null> {
  const { rows } = await getPool().query('SELECT * FROM star_sync WHERE user_id=$1', [userId]);
  if (!rows[0]) return null;
  const row = rows[0];
  const data = row.data as ScanData;
  return {
    enabled: row.enabled,
    nextSyncAt: row.next_run_at.toISOString(),
    lastSyncAt: data.lastSyncAt,
    lastAdded: data.lastAdded,
    nextPage: data.page,
    error: data.error,
    intervalMinutes: getConfig().SYNC_STAR_INTERVAL_MINUTES,
  };
}
export async function setStarSync(userId: string, enabled: boolean) {
  await accountIdFor(userId);
  await transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`subscription:${userId}`]);
    await client.query(
      `INSERT INTO star_sync(user_id,enabled,data) VALUES($1,$2,
      '{"page":1,"scanStartedAt":null,"lastSyncAt":null,"lastAdded":0,"error":null}'::jsonb || $3::jsonb)
      ON CONFLICT(user_id) DO UPDATE SET enabled=$2,
      next_run_at=greatest(now(),(star_sync.data->>'retryAt')::timestamptz),
      data=star_sync.data || '{"page":1,"scanStartedAt":null}'::jsonb || $3::jsonb`,
      [userId, enabled, JSON.stringify({ generation: randomUUID() })],
    );
  });
  return getStarSync(userId);
}
export async function requestStarSync(userId: string) {
  await accountIdFor(userId);
  const { rows } = await getPool().query('SELECT enabled,data FROM star_sync WHERE user_id=$1', [
    userId,
  ]);
  if (!rows[0]?.enabled) throw new GitHubError('请先开启 Star 自动跟踪。', 400);
  const retryAt = rows[0].data.retryAt;
  if (retryAt && Date.parse(retryAt) > Date.now())
    throw new GitHubError('GitHub 限流等待中，请稍后再检查。', 429);
  return enqueue(userId, 'stars', userId);
}

export async function scheduleStarSync() {
  const config = getConfig();
  if (config.APP_MODE === 'demo') return;
  const allowed = config.ALLOWED_GITHUB_USER_IDS.split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO star_sync(user_id)
      SELECT DISTINCT a."userId" FROM account a JOIN app_users u ON u.id=a."userId"
      WHERE a."providerId"='github' AND a."accountId"=ANY($1::text[]) ON CONFLICT DO NOTHING`,
      [allowed],
    );
    const { rows } = await client.query(
      `SELECT s.user_id FROM star_sync s WHERE s.enabled AND s.next_run_at<=now()
      AND EXISTS(SELECT 1 FROM account a WHERE a."userId"=s.user_id AND a."providerId"='github' AND a."accountId"=ANY($1::text[]))
      ORDER BY s.next_run_at LIMIT 20 FOR UPDATE OF s SKIP LOCKED`,
      [allowed],
    );
    for (const row of rows) {
      await client.query(
        "INSERT INTO jobs(id,user_id,kind,target_id) VALUES($1,$2,'stars',$2) ON CONFLICT DO NOTHING",
        [randomUUID(), row.user_id],
      );
      await client.query(
        "UPDATE star_sync SET next_run_at=now()+($2 * interval '1 minute') WHERE user_id=$1",
        [row.user_id, config.SYNC_STAR_INTERVAL_MINUTES],
      );
    }
  });
}

export async function syncStarred(
  userId: string,
  connector?: GitHubConnector,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const { rows } = await getPool().query('SELECT enabled,data FROM star_sync WHERE user_id=$1', [
    userId,
  ]);
  if (!rows[0]?.enabled) return;
  const data = rows[0].data as ScanData;
  const generation = data.generation ?? '';
  if (data.retryAt && Date.parse(data.retryAt) > Date.now())
    throw new GitHubError('GitHub 限流等待中，请稍后再检查。', 429);
  const startedAt = data.scanStartedAt || new Date().toISOString();
  try {
    const accountId = await accountIdFor(userId);
    connector ??= await createUserGitHubConnector(userId, signal);
    const username = await connector.usernameById(accountId);
    signal?.throwIfAborted();
    await getPool().query(
      "UPDATE star_sync SET data=data || $2::jsonb WHERE user_id=$1 AND enabled AND coalesce(data->>'generation','')=$3",
      [userId, JSON.stringify({ scanStartedAt: startedAt }), generation],
    );
    for (let page = data.page, step = 0; step < 5; step++, page++) {
      signal?.throwIfAborted();
      if (!(await getStarSync(userId))?.enabled) return;
      const result = await connector.starred(username, page);
      for (const repo of result.repositories) {
        signal?.throwIfAborted();
        await persistSubscription(
          userId,
          'repo',
          { externalId: repo.id, name: repo.name, description: repo.description, url: repo.url },
          { automatic: true, generation, signal },
        );
      }
      signal?.throwIfAborted();
      await transaction(async (client) => {
        const added = await client.query(
          "SELECT count(*)::int AS count FROM subscriptions WHERE user_id=$1 AND data->>'autoFromStar'='true' AND (data->>'createdAt')::timestamptz >= $2",
          [userId, startedAt],
        );
        signal?.throwIfAborted();
        await client.query(
          `UPDATE star_sync SET data=data || $2::jsonb,
          next_run_at=now()+($3 * interval '1 second') WHERE user_id=$1 AND enabled
          AND coalesce(data->>'generation','')=$4`,
          [
            userId,
            JSON.stringify(
              result.nextPage
                ? { page: result.nextPage, scanStartedAt: startedAt, error: null, retryAt: null }
                : {
                    page: 1,
                    scanStartedAt: null,
                    lastSyncAt: new Date().toISOString(),
                    lastAdded: added.rows[0].count,
                    error: null,
                    retryAt: null,
                  },
            ),
            result.nextPage ? 5 : getConfig().SYNC_STAR_INTERVAL_MINUTES * 60,
            generation,
          ],
        );
        signal?.throwIfAborted();
      });
      if (!result.nextPage) return;
    }
  } catch (error) {
    signal?.throwIfAborted();
    const known = error instanceof GitHubError;
    const delay =
      known && error.status === 429
        ? error.retryAfter
        : getConfig().SYNC_STAR_INTERVAL_MINUTES * 60;
    const retryAt = new Date(Date.now() + delay * 1000).toISOString();
    await getPool().query(
      `UPDATE star_sync SET enabled=enabled AND NOT $3, next_run_at=$4,
      data=data || $2::jsonb WHERE user_id=$1 AND enabled AND coalesce(data->>'generation','')=$5`,
      [
        userId,
        JSON.stringify({
          error: known ? error.message : 'Star 列表检查失败，稍后会重试。',
          retryAt: known && error.status === 429 ? retryAt : null,
        }),
        known && [401, 404].includes(error.status),
        retryAt,
        generation,
      ],
    );
    throw error;
  }
}
