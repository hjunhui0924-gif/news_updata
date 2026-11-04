import { createHash, randomUUID } from 'node:crypto';
import { GitHubConnector } from '../connectors/github';
import { GitHubAdapter } from '../platforms/github';
import {
  CursorExpiredError,
  PlatformError,
  type PlatformAdapter,
  type PageValidator,
} from '../platforms/contract';
import { assertSourceKind, createPlatformAdapter } from '../platforms/registry';
import {
  itemExternalKey,
  sourcePlatform,
  platformLabels,
  type PlatformId,
  type SourceKind,
} from '@/shared/platforms';
import { getPool, transaction } from '../db/client';
import { getSubscription } from '../db/store';
import { enqueue } from '../jobs/queue';
import { getConfig } from '../config';
import { persistUpdates } from './ingest';
import type { FeedItem, Subscription } from '@/shared/types';

export async function addSubscription(
  userId: string,
  kind: SourceKind,
  input: string,
  connector?: GitHubConnector | PlatformAdapter,
  platform: PlatformId = 'github',
) {
  assertSourceKind(platform, kind);
  const adapter = await getAdapter(userId, platform, connector);
  const resolved = await adapter.resolve(kind, input);
  const result = await persistSubscription(userId, kind, resolved, { platform });
  return result!.subscription;
}

export async function persistSubscription(
  userId: string,
  kind: SourceKind,
  resolved: {
    externalId: string;
    name: string;
    description: string;
    url: string;
    adapterData?: Record<string, string>;
  },
  options: {
    automatic?: boolean;
    generation?: string;
    signal?: AbortSignal;
    platform?: PlatformId;
    connectionGeneration?: string;
  } = {},
) {
  const platform = options.platform ?? 'github';
  assertSourceKind(platform, kind);
  if (options.automatic && (platform !== 'github' || kind !== 'repo'))
    throw new PlatformError('自动 Star 导入只支持 GitHub 仓库。', 400);
  return transaction(async (client) => {
    options.signal?.throwIfAborted();
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`subscription:${userId}`]);
    if (options.connectionGeneration) {
      const connection = await client.query(
        "SELECT 1 FROM platform_connections WHERE user_id=$1 AND platform=$2 AND generation=$3 AND state='connected' FOR SHARE",
        [userId, platform, options.connectionGeneration],
      );
      if (!connection.rowCount)
        throw new PlatformError('平台账号已变化，请重新读取关注后导入。', 409);
    }
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
    } else if (platform === 'github' && kind === 'repo') {
      await client.query('DELETE FROM star_sync_exclusions WHERE user_id=$1 AND external_id=$2', [
        userId,
        resolved.externalId,
      ]);
    }
    const existing = await client.query(
      'SELECT data FROM subscriptions WHERE user_id=$1 AND kind=$2 AND external_id=$3 AND platform=$4',
      [userId, kind, resolved.externalId, platform],
    );
    if (existing.rows[0])
      return { subscription: existing.rows[0].data as Subscription, created: false };
    const count = await client.query(
      'SELECT count(*) FROM subscriptions WHERE user_id=$1 AND kind=$2 AND platform=$3',
      [userId, kind, platform],
    );
    if (Number(count.rows[0].count) >= (kind === 'repo' ? 100 : 50))
      throw new PlatformError('已达到本地试用的订阅数量上限。', 400);
    const data: Subscription = {
      id: randomUUID(),
      kind,
      ...resolved,
      platform,
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
      'INSERT INTO subscriptions(id,user_id,external_id,kind,data,platform) VALUES($1,$2,$3,$4,$5,$6)',
      [data.id, userId, data.externalId, kind, data, platform],
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
      'DELETE FROM subscriptions WHERE user_id=$1 AND id=$2 RETURNING kind,external_id,platform',
      [userId, id],
    );
    if (rows[0]?.kind === 'repo' && rows[0]?.platform === 'github')
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
  if (!result.rows[0]) throw new PlatformError('订阅不存在', 404);
  if (patch.enabled) await enqueue(userId, 'sync', id);
  return result.rows[0].data as Subscription;
}

export async function syncSubscription(
  userId: string,
  id: string,
  connector?: GitHubConnector | PlatformAdapter,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const sub = await getSubscription(userId, id);
  if (!sub || !sub.enabled) return;
  if (sub.retryAt && Date.parse(sub.retryAt) > Date.now())
    throw new PlatformError(
      `${platformLabels[sourcePlatform(sub)]} 限流等待中，请到期后重试。`,
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
  const startedAt = new Date().toISOString();
  try {
    const platform = sourcePlatform(sub);
    const adapter = await getAdapter(userId, platform, connector, signal);
    assertSourceKind(platform, sub.kind);
    let allComplete = true;
    let eventWindowCapped = false;
    const streams = adapter.streams(sub);
    for (const [streamIndex, stream] of streams.entries()) {
      const cursorKey = `sync:${userId}:${id}${streamIndex ? `:${stream}` : ''}`;
      const stored = await getPool().query('SELECT value FROM system_state WHERE key=$1', [
        cursorKey,
      ]);
      const cursor = stored.rows[0]?.value as
        | {
            page: number;
            historyCount: number;
            completed?: boolean;
            nextToken?: string;
            pages?: Record<string, PageValidator>;
          }
        | undefined;
      // Legacy ETags have no pagination metadata and are deliberately not reused.
      const pages = { ...(cursor?.pages ?? {}) };
      let page = cursor && !cursor.completed ? cursor.page : 1;
      let historyCount = cursor && !cursor.completed ? cursor.historyCount : 0;
      let nextToken = cursor && !cursor.completed ? cursor.nextToken : undefined;
      let streamComplete = false;
      // Work is bounded for every provider; unfinished cursors resume on the next task.
      for (let iteration = 0; iteration < 5; iteration++, page++) {
        signal?.throwIfAborted();
        const pageKey = String(page);
        const cached = pages[pageKey];
        let received;
        try {
          received = await adapter.readPage(sub, stream, {
            page,
            cursor: nextToken,
            validator: cached,
          });
        } catch (error) {
          if (error instanceof CursorExpiredError)
            await getPool().query('DELETE FROM system_state WHERE key=$1', [cursorKey]);
          throw error;
        }
        const response = received.notModified
          ? { ...received, nextCursor: received.nextCursor ?? cached?.nextCursor }
          : received;
        if (response.notModified) {
          if (!cached) throw new PlatformError('同步缓存不可用，请重新同步。', 502);
          historyCount += cached.historyIncrement;
        }
        const historyBeforePage = historyCount;
        if ('windowCapped' in response) eventWindowCapped ||= !!response.windowCapped;
        const known = await getPool().query(
          'SELECT external_key FROM items WHERE user_id=$1 AND external_key=ANY($2::text[])',
          [userId, response.items.map((update) => itemExternalKey({ ...update, platform }))],
        );
        const existingKeys = new Set(known.rows.map((row) => row.external_key));
        const rows: FeedItem[] = [];
        for (const candidate of response.items) {
          signal?.throwIfAborted();
          const backfill = Date.parse(candidate.publishedAt) < Date.parse(sub.createdAt);
          const existing = existingKeys.has(itemExternalKey({ ...candidate, platform }));
          // Previously captured notes remain eligible for edits even after the initial-history window.
          if (
            !existing &&
            backfill &&
            (historyCount >= 20 ||
              Date.parse(candidate.publishedAt) < Date.parse(sub.createdAt) - 30 * 86400000)
          )
            continue;
          // Count known candidates too, so later scans cannot expand the historical import cap.
          if (backfill) historyCount++;
          const update = await adapter.materialize(candidate);
          const contentHash = createHash('sha256')
            .update(`${update.title}\n${update.description}\n${update.body}`)
            .digest('hex');
          const itemId = createHash('sha256')
            .update(`${userId}:${itemExternalKey({ ...update, platform })}`)
            .digest('hex')
            .slice(0, 32);
          rows.push({
            id: itemId,
            sourceId: id,
            sourceIds: [id],
            ...update,
            repo: update.sourceName,
            platform,
            firstSeenAt: new Date().toISOString(),
            contentHash,
            language: /[\u4e00-\u9fff]/.test(update.body.slice(0, 300)) ? 'zh' : 'en',
            tags: [platformLabels[platform]],
            color: 'slate',
            demo: false,
            backfill,
            summary: null,
            aiStatus:
              update.type === 'video'
                ? 'insufficient'
                : update.body
                  ? getConfig().LLM_ENABLED === 'true'
                    ? 'pending'
                    : 'disabled'
                  : 'insufficient',
            translation: null,
            read: false,
            saved: false,
            muted: false,
            priority: sub.priority,
          });
        }
        const complete = !response.hasNext || !!response.historyComplete;
        if (!response.notModified) {
          if (response.etag)
            pages[pageKey] = {
              etag: response.etag,
              hasNext: response.hasNext,
              pageSize: response.pageSize,
              historyIncrement: historyCount - historyBeforePage,
              ...(response.nextCursor ? { nextCursor: response.nextCursor } : {}),
            };
          else delete pages[pageKey];
        }
        const active = await transaction(async (client) => {
          signal?.throwIfAborted();
          const current = await client.query(
            "SELECT id FROM subscriptions WHERE user_id=$1 AND id=$2 AND (data->>'enabled')::boolean FOR UPDATE",
            [userId, id],
          );
          if (!current.rowCount) return false;
          await persistUpdates(client, userId, rows);
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
                ...(!complete && response.nextCursor ? { nextToken: response.nextCursor } : {}),
                ...(Object.keys(pages).length ? { pages } : {}),
              },
            ],
          );
          await client.query(
            `UPDATE subscriptions SET data=CASE
              WHEN $4::boolean AND data->'syncProgress'->>'nextPage' IS NOT NULL
                AND data->'syncProgress'->>'stream' <> $5 THEN data
              ELSE data || $3::jsonb END WHERE user_id=$1 AND id=$2`,
            [
              userId,
              id,
              JSON.stringify({
                syncProgress: { stream, page, nextPage: complete ? null : page + 1 },
              }),
              complete,
              stream,
            ],
          );
          signal?.throwIfAborted();
          return true;
        });
        if (!active) return;
        nextToken = response.nextCursor;
        if (complete) {
          streamComplete = true;
          break;
        }
      }
      allComplete &&= streamComplete;
    }
    signal?.throwIfAborted();
    await getPool().query(
      'UPDATE subscriptions SET data=data || $3::jsonb WHERE user_id=$1 AND id=$2',
      [
        userId,
        id,
        JSON.stringify({
          coverage: allComplete ? 'complete' : 'partial',
          ...(allComplete ? { lastSyncAt: startedAt } : {}),
          error: null,
          retryAt: null,
          syncWindowCapped: eventWindowCapped,
          ...(streams.includes('author-releases')
            ? { authorEventWindowCapped: eventWindowCapped }
            : {}),
        }),
      ],
    );
  } catch (error) {
    signal?.throwIfAborted();
    const message = error instanceof PlatformError ? error.message : '本轮同步未完成，稍后可重试。';
    const retryAt =
      error instanceof PlatformError && error.status === 429
        ? new Date(Date.now() + error.retryAfter * 1000).toISOString()
        : null;
    const paused = error instanceof PlatformError && [401, 404].includes(error.status);
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

async function getAdapter(
  userId: string,
  platform: PlatformId,
  injected?: GitHubConnector | PlatformAdapter,
  signal?: AbortSignal,
) {
  const adapter =
    injected instanceof GitHubConnector
      ? new GitHubAdapter(injected)
      : (injected ?? (await createPlatformAdapter(userId, platform, signal)));
  if (adapter.platform !== platform) throw new PlatformError('来源平台与连接器不一致。', 400);
  return adapter;
}
