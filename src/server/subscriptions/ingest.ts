import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { FeedItem } from '@/shared/types';
import { itemSourceIds } from '@/shared/feed';

export async function persistUpdates(client: PoolClient, userId: string, updates: FeedItem[]) {
  // Consistent lock order covers concurrent source pages, including rows not inserted yet.
  for (const incoming of [...updates].sort((a, b) => a.id.localeCompare(b.id))) {
    const key = `${incoming.type}:${incoming.externalId}`;
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`item:${userId}:${key}`]);
    const previous = (
      await client.query('SELECT data FROM items WHERE user_id=$1 AND external_key=$2 FOR UPDATE', [
        userId,
        key,
      ])
    ).rows[0]?.data as FeedItem | undefined;
    const older =
      previous?.sourceUpdatedAt &&
      incoming.sourceUpdatedAt &&
      Date.parse(previous.sourceUpdatedAt) > Date.parse(incoming.sourceUpdatedAt);
    const changed = !previous || (!older && previous.contentHash !== incoming.contentHash);
    const item: FeedItem = {
      ...(changed ? incoming : previous!),
      id: previous?.id ?? incoming.id,
      sourceId: previous?.sourceId ?? incoming.sourceId,
      sourceIds: [
        ...new Set([...(previous ? itemSourceIds(previous) : []), ...itemSourceIds(incoming)]),
      ],
      firstSeenAt: previous?.firstSeenAt ?? incoming.firstSeenAt,
      backfill: previous ? previous.backfill && incoming.backfill : incoming.backfill,
      ...(!older && incoming.sourceUpdatedAt ? { sourceUpdatedAt: incoming.sourceUpdatedAt } : {}),
    };
    if (previous && JSON.stringify(previous) === JSON.stringify(item)) continue;
    await client.query(
      'INSERT INTO items(id,user_id,source_id,external_key,data,published_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,external_key) DO UPDATE SET data=excluded.data,published_at=excluded.published_at',
      [item.id, userId, item.sourceId, key, item, item.publishedAt],
    );
    if (changed && item.aiStatus === 'pending')
      await client.query(
        "INSERT INTO jobs(id,user_id,kind,target_id) VALUES($1,$2,'summary',$3) ON CONFLICT DO NOTHING",
        [randomUUID(), userId, item.id],
      );
  }
}
