import { createHash, randomUUID } from 'node:crypto';
import { GitHubConnector, GitHubError } from '../connectors/github';
import { createUserGitHubConnector } from '../connectors/github-user';
import { getPool, transaction } from '../db/client';
import { getSubscription } from '../db/store';
import { enqueue } from '../jobs/queue';
import { getConfig } from '../config';
import type { FeedItem, Subscription } from '@/shared/types';

export async function addSubscription(
  userId: string,
  kind: 'repo' | 'author',
  input: string,
  connector?: GitHubConnector,
) {
  connector ??= await createUserGitHubConnector(userId);
  const resolved = await connector.resolve(kind, input);
  const result = await persistSubscription(userId, kind, resolved);
  return result!.subscription;
}

export async function persistSubscription(
  userId: string,
  kind: 'repo' | 'author',
  resolved: { externalId: string; name: string; description: string; url: string },
  options: { automatic?: boolean; generation?: string; signal?: AbortSignal } = {},
) {
  return transaction(async (client) => {
    options.signal?.throwIfAborted();
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`subscription:${userId}`]);
    if (options.automatic) {
      const state = await client.query(
        'SELECT enabled,data FROM star_sync WHERE user_id=$1 FOR SHARE',
        [userId],
      );
      if (!state.rows[0]?.enabled) return null;
      if ((state.rows[0].data.generation ?? '') !== options.generation) return null;
      const excluded = await client.query(
        'SELECT 1 FROM star_sync_exclusions WHERE user_id=$1 AND external_id=$2',
        [userId, resolved.externalId],
      );
      if (excluded.rowCount) return null;
    } else if (kind === 'repo') {
      await client.query('DELETE FROM star_sync_exclusions WHERE user_id=$1 AND external_id=$2', [
        userId,
        resolved.externalId,
      ]);
    }
    const existing = await client.query(
      'SELECT data FROM subscriptions WHERE user_id=$1 AND kind=$2 AND external_id=$3',
      [userId, kind, resolved.externalId],
    );
    if (existing.rows[0])
      return { subscription: existing.rows[0].data as Subscription, created: false };
    const count = await client.query(
      'SELECT count(*) FROM subscriptions WHERE user_id=$1 AND kind=$2',
      [userId, kind],
    );
    if (Number(count.rows[0].count) >= (kind === 'repo' ? 100 : 50))
      throw new GitHubError('已达到本地试用的订阅数量上限。', 400);
    const data: Subscription = {
      id: randomUUID(),
      kind,
      ...resolved,
      enabled: true,
      priority: false,
      demo: false,
      createdAt: new Date().toISOString(),
      lastSyncAt: null,
      error: null,
      coverage: 'pending',
      ...(options.automatic ? { autoFromStar: true } : {}),
    };
    await client.query(
      'INSERT INTO subscriptions(id,user_id,external_id,kind,data) VALUES($1,$2,$3,$4,$5)',
      [data.id, userId, data.externalId, kind, data],
    );
    // This record is the transactional outbox; the worker publishes it to pg-boss.
    await client.query('INSERT INTO jobs(id,user_id,kind,target_id) VALUES($1,$2,$3,$4)', [
      randomUUID(),
      userId,
      'sync',
      data.id,
    ]);
    options.signal?.throwIfAborted();
    return { subscription: data, created: true };
  });
}

export async function deleteSubscription(userId: string, id: string) {
  await transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`subscription:${userId}`]);
    const { rows } = await client.query(
      'DELETE FROM subscriptions WHERE user_id=$1 AND id=$2 RETURNING kind,external_id',
      [userId, id],
    );
    if (rows[0]?.kind === 'repo')
      await client.query(
        'INSERT INTO star_sync_exclusions(user_id,external_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [userId, rows[0].external_id],
      );
  });
}

export async function updateSubscription(
  userId: string,
  id: string,
  patch: Partial<Pick<Subscription, 'enabled' | 'priority'>>,
) {
  const result = await getPool().query(
    'UPDATE subscriptions SET data=data || $3::jsonb WHERE user_id=$1 AND id=$2 RETURNING data',
    [userId, id, JSON.stringify(patch)],
  );
  if (!result.rows[0]) throw new GitHubError('订阅不存在', 404);
  if (patch.enabled) await enqueue(userId, 'sync', id);
  return result.rows[0].data as Subscription;
}

export async function syncSubscription(
  userId: string,
  id: string,
  connector?: GitHubConnector,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const sub = await getSubscription(userId, id);
  if (!sub || !sub.enabled) return;
  if (sub.retryAt && Date.parse(sub.retryAt) > Date.now())
    throw new GitHubError(
      'GitHub 限流等待中，请到期后重试。',
      429,
      (Date.parse(sub.retryAt) - Date.now()) / 1000,
    );
  if (sub.demo) {
    await getPool().query(
      'UPDATE subscriptions SET data=data || $3::jsonb WHERE user_id=$1 AND id=$2',
      [userId, id, JSON.stringify({ lastSyncAt: new Date().toISOString(), error: null })],
    );
    return;
  }
  const cursorKey = `sync:${userId}:${id}`;
  const stored = await getPool().query('SELECT value FROM system_state WHERE key=$1', [cursorKey]);
  const cursor = stored.rows[0]?.value as
    | { page: number; historyCount: number; startedAt: string; etag?: string; completed?: boolean }
    | undefined;
  let page = cursor && !cursor.completed ? cursor.page : 1;
  let historyCount = cursor && !cursor.completed ? cursor.historyCount : 0;
  const startedAt = cursor && !cursor.completed ? cursor.startedAt : new Date().toISOString();
  try {
    connector ??= await createUserGitHubConnector(userId, signal);
    // Five pages per job keeps work bounded; unfinished scans retain a durable next page.
    for (let iteration = 0; iteration < 5; iteration++, page++) {
      signal?.throwIfAborted();
      const response = await connector.updates(sub.kind, sub.name, page, undefined);
      const rows: FeedItem[] = [];
      for (const update of response.items) {
        signal?.throwIfAborted();
        const backfill = Date.parse(update.publishedAt) < Date.parse(sub.createdAt);
        if (
          backfill &&
          (historyCount >= 20 ||
            Date.parse(update.publishedAt) < Date.parse(sub.createdAt) - 30 * 86400000)
        )
          continue;
        if (backfill) historyCount++;
        if (update.type === 'new_repo') update.body = await connector.readme(update.repo);
        const contentHash = createHash('sha256')
          .update(`${update.title}\n${update.description}\n${update.body}`)
          .digest('hex');
        const itemId = createHash('sha256')
          .update(`${userId}:${update.type}:${update.externalId}`)
          .digest('hex')
          .slice(0, 32);
        rows.push({
          id: itemId,
          sourceId: id,
          ...update,
          firstSeenAt: new Date().toISOString(),
          contentHash,
          language: /[\u4e00-\u9fff]/.test(update.body.slice(0, 300)) ? 'zh' : 'en',
          tags: ['GitHub'],
          color: 'slate',
          demo: false,
          backfill,
          summary: null,
          aiStatus: update.body
            ? getConfig().LLM_ENABLED === 'true'
              ? 'pending'
              : 'disabled'
            : 'insufficient',
          translation: null,
          read: false,
          saved: false,
          muted: false,
          priority: sub.priority,
        } satisfies FeedItem);
      }
      const authorBoundary =
        sub.kind === 'author' &&
        response.items.some(
          (x) =>
            Date.parse(x.publishedAt) < Date.parse(sub.lastSyncAt ?? sub.createdAt) - 30 * 86400000,
        );
      const complete = !response.hasNext || authorBoundary || !!response.notModified;
      await transaction(async (client) => {
        signal?.throwIfAborted();
        for (const item of rows) {
          const existing = await client.query(
            'SELECT data FROM items WHERE user_id=$1 AND external_key=$2 FOR UPDATE',
            [userId, `${item.type}:${item.externalId}`],
          );
          if (existing.rows[0]?.data.contentHash === item.contentHash) continue;
          if (existing.rows[0]) {
            item.firstSeenAt = existing.rows[0].data.firstSeenAt;
            item.backfill = existing.rows[0].data.backfill;
          }
          await client.query(
            'INSERT INTO items(id,user_id,source_id,external_key,data,published_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,external_key) DO UPDATE SET data=excluded.data,published_at=excluded.published_at',
            [item.id, userId, id, `${item.type}:${item.externalId}`, item, item.publishedAt],
          );
          if (item.aiStatus === 'pending')
            await client.query(
              "INSERT INTO jobs(id,user_id,kind,target_id) VALUES($1,$2,'summary',$3) ON CONFLICT DO NOTHING",
              [randomUUID(), userId, item.id],
            );
        }
        signal?.throwIfAborted();
        await client.query(
          'INSERT INTO system_state(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
          [
            cursorKey,
            {
              page: complete ? 1 : page + 1,
              historyCount: complete ? 0 : historyCount,
              startedAt,
              completed: complete,
            },
          ],
        );
        await client.query(
          'UPDATE subscriptions SET data=data || $3::jsonb WHERE user_id=$1 AND id=$2',
          [
            userId,
            id,
            JSON.stringify({
              coverage: complete ? 'complete' : 'partial',
              ...(complete ? { lastSyncAt: startedAt } : {}),
              error: null,
              retryAt: null,
            }),
          ],
        );
        signal?.throwIfAborted();
      });
      if (complete) return;
    }
  } catch (error) {
    signal?.throwIfAborted();
    const message = error instanceof GitHubError ? error.message : '本轮同步未完成，稍后可重试。';
    const retryAt =
      error instanceof GitHubError && error.status === 429
        ? new Date(Date.now() + error.retryAfter * 1000).toISOString()
        : null;
    const paused = error instanceof GitHubError && [401, 404].includes(error.status);
    await getPool().query(
      'UPDATE subscriptions SET data=data || $3::jsonb WHERE user_id=$1 AND id=$2',
      [
        userId,
        id,
        JSON.stringify({
          error: message,
          coverage: 'partial',
          retryAt,
          ...(paused ? { enabled: false } : {}),
        }),
      ],
    );
    throw error;
  }
}
