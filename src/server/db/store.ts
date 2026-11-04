import { desc, eq, and, sql, lt, or } from 'drizzle-orm';
import { getDb, getPool } from './client';
import { items, subscriptions, preferences } from './schema';
import type {
  FeedItem,
  FeedPreview,
  FeedPage,
  Preferences,
  Subscription,
  Notification,
} from '@/shared/types';
import { mapJob } from '../jobs/queue';
import { itemSourceIds } from '@/shared/feed';
import { itemExternalKey, sourcePlatform } from '@/shared/platforms';
import { z } from 'zod';
import { currentArtifactVersions, withCurrentArtifacts } from '../ai/artifact-version';

export const defaultPreferences: Preferences = { timezone: 'Asia/Shanghai', compact: false };

export async function getItems(userId: string): Promise<FeedItem[]> {
  const rows = await getDb()
    .select()
    .from(items)
    .where(eq(items.userId, userId))
    .orderBy(desc(items.publishedAt), desc(items.id));
  const versions = currentArtifactVersions();
  return rows.map((row) =>
    withCurrentArtifacts(
      { ...row.data, read: row.read, saved: row.saved, muted: row.muted },
      versions,
    ),
  );
}
type FeedQuery = {
  view: string;
  type: string;
  search: string;
  unread: boolean;
  source: string;
  cursor?: string | null;
};
function feedConditions(userId: string, input: FeedQuery) {
  const conditions = [eq(items.userId, userId), eq(items.muted, false)];
  if (input.view === 'saved') conditions.push(eq(items.saved, true));
  if (input.type !== 'all') conditions.push(sql`${items.data}->>'type' = ${input.type}` as never);
  if (input.unread) conditions.push(eq(items.read, false));
  if (input.source)
    conditions.push(
      sql`(${items.data}->>'sourceId' = ${input.source} OR ${items.data}->'sourceIds' ? ${input.source})` as never,
    );
  const query = input.search.trim();
  if (query) {
    const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    conditions.push(sql`${items.searchText} ILIKE ${pattern}` as never);
  }
  return conditions;
}
export async function markFeedRead(userId: string, input: FeedQuery) {
  const rows = await getDb()
    .update(items)
    .set({ read: true })
    .where(and(...feedConditions(userId, input), eq(items.read, false)))
    .returning({ id: items.id });
  return rows.length;
}
export async function getFeedStatus(userId: string, input: FeedQuery) {
  const matching = and(...feedConditions(userId, input));
  const [countRows, head] = await Promise.all([
    getDb()
      .select({
        all: sql<number>`count(*) FILTER (WHERE NOT ${items.muted})::int`,
        unread: sql<number>`count(*) FILTER (WHERE NOT ${items.muted} AND NOT ${items.read})::int`,
        saved: sql<number>`count(*) FILTER (WHERE NOT ${items.muted} AND ${items.saved})::int`,
        total: sql<number>`count(*) FILTER (WHERE ${matching})::int`,
        matchingUnread: sql<number>`count(*) FILTER (WHERE ${matching} AND NOT ${items.read})::int`,
      })
      .from(items)
      .where(eq(items.userId, userId)),
    getDb()
      .select({ id: items.id })
      .from(items)
      .where(matching)
      .orderBy(desc(items.publishedAt), desc(items.id))
      .limit(1),
  ]);
  return { ...countRows[0], headId: head[0]?.id ?? null };
}
export async function getFeedPage(userId: string, input: FeedQuery): Promise<FeedPage> {
  const limit = 30;
  const conditions = feedConditions(userId, input);
  const filterConditions = [...conditions];
  if (input.cursor) {
    const cursor = decodeFeedCursor(input.cursor);
    conditions.push(
      or(
        lt(items.publishedAt, new Date(cursor.publishedAt)),
        and(eq(items.publishedAt, new Date(cursor.publishedAt)), lt(items.id, cursor.id)),
      )!,
    );
  }
  const where = and(...conditions);
  const [rows, filteredCount, counts] = await Promise.all([
    getDb()
      .select({
        id: items.id,
        publishedAt: items.publishedAt,
        read: items.read,
        saved: items.saved,
        muted: items.muted,
        data: sql<FeedPreview>`(${items.data} - ARRAY['body','contentHash','translation','translationBlocks','summary','aiError']::text[]) || jsonb_build_object('summary', CASE WHEN ${items.data}->'summary' IS NULL OR ${items.data}->'summary'='null'::jsonb THEN 'null'::jsonb ELSE jsonb_build_object('overview',left(${items.data}->'summary'->>'overview',400)) END)`,
      })
      .from(items)
      .where(where)
      .orderBy(desc(items.publishedAt), desc(items.id))
      .limit(limit + 1),
    getDb()
      .select({
        value: sql<number>`count(*)::int`,
        unread: sql<number>`count(*) FILTER (WHERE NOT ${items.read})::int`,
      })
      .from(items)
      .where(and(...filterConditions)),
    getPool().query(
      `SELECT count(*) FILTER (WHERE NOT muted)::int AS total,
              count(*) FILTER (WHERE NOT muted AND NOT read)::int AS unread,
              count(*) FILTER (WHERE NOT muted AND saved)::int AS saved
         FROM items WHERE user_id=$1`,
      [userId],
    ),
  ]);
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  const currentSubscriptions = new Map(
    (await getSubscriptions(userId)).map((subscription) => [subscription.id, subscription]),
  );
  const versions = currentArtifactVersions();
  const pageItems = pageRows.map((row) => {
    const item = { ...row.data, read: row.read, saved: row.saved, muted: row.muted };
    const sourceIds = itemSourceIds(item);
    return {
      ...withCurrentArtifacts(item, versions),
      priority: sourceIds.some((id) => currentSubscriptions.get(id)?.priority),
      matchedSources: sourceIds.flatMap((id) => {
        const subscription = currentSubscriptions.get(id);
        return subscription ? [{ id, kind: subscription.kind, name: subscription.name }] : [];
      }),
    };
  });
  return {
    items: pageItems,
    total: Number(filteredCount[0]?.value ?? 0),
    matchingUnread: Number(filteredCount[0]?.unread ?? 0),
    unread: Number(counts.rows[0].unread),
    saved: Number(counts.rows[0].saved),
    all: Number(counts.rows[0].total),
    nextCursor: hasMore && last ? encodeFeedCursor(last.publishedAt.toISOString(), last.id) : null,
  };
}
function encodeFeedCursor(publishedAt: string, id: string) {
  return Buffer.from(JSON.stringify({ publishedAt, id })).toString('base64url');
}
function decodeFeedCursor(value: string) {
  try {
    return z
      .object({ publishedAt: z.iso.datetime(), id: z.string().min(1).max(200) })
      .parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    throw new z.ZodError([
      { code: 'custom', path: ['cursor'], message: '分页位置无效，请刷新列表重试。' },
    ]);
  }
}
export async function getItem(userId: string, id: string) {
  const rows = await getDb()
    .select()
    .from(items)
    .where(and(eq(items.userId, userId), eq(items.id, id)))
    .limit(1);
  if (!rows[0]) return null;
  const item = withCurrentArtifacts(
    { ...rows[0].data, read: rows[0].read, saved: rows[0].saved, muted: rows[0].muted },
    currentArtifactVersions(),
  );
  const sources = new Map((await getSubscriptions(userId)).map((source) => [source.id, source]));
  const ids = itemSourceIds(item);
  return {
    ...item,
    priority: ids.some((id) => sources.get(id)?.priority),
    matchedSources: ids.flatMap((id) => {
      const source = sources.get(id);
      return source ? [{ id, kind: source.kind, name: source.name }] : [];
    }),
  };
}
export async function saveItem(userId: string, item: FeedItem) {
  await getDb()
    .insert(items)
    .values({
      id: item.id,
      userId,
      sourceId: item.sourceId,
      externalKey: itemExternalKey(item),
      publishedAt: new Date(item.publishedAt),
      data: item,
      read: item.read,
      saved: item.saved,
      muted: item.muted,
    })
    .onConflictDoUpdate({
      target: [items.userId, items.externalKey],
      set: { data: item, publishedAt: new Date(item.publishedAt) },
    });
}
export async function patchItemState(
  userId: string,
  id: string,
  patch: Partial<Pick<FeedItem, 'read' | 'saved' | 'muted'>>,
) {
  const result = await getDb()
    .update(items)
    .set(patch)
    .where(and(eq(items.userId, userId), eq(items.id, id)))
    .returning({ id: items.id });
  return result.length > 0;
}
export async function getSubscriptions(userId: string): Promise<Subscription[]> {
  return (
    await getDb()
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .orderBy(
        desc(sql`(${subscriptions.data}->>'createdAt')::timestamptz`),
        desc(subscriptions.id),
      )
  ).map((row) => row.data);
}
export async function getSubscription(userId: string, id: string) {
  const rows = await getDb()
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.id, id)))
    .limit(1);
  return rows[0]?.data ?? null;
}
export async function saveSubscription(userId: string, data: Subscription) {
  const result = await getDb()
    .insert(subscriptions)
    .values({
      id: data.id,
      userId,
      externalId: data.externalId,
      platform: sourcePlatform(data),
      kind: data.kind,
      data,
    })
    .onConflictDoUpdate({
      target: [
        subscriptions.userId,
        subscriptions.platform,
        subscriptions.kind,
        subscriptions.externalId,
      ],
      set: { data },
    })
    .returning();
  return result[0].data;
}
export async function getPreferences(userId: string) {
  const rows = await getDb()
    .select()
    .from(preferences)
    .where(eq(preferences.userId, userId))
    .limit(1);
  return rows[0]?.data ?? defaultPreferences;
}
export async function savePreferences(userId: string, data: Preferences) {
  await getDb()
    .insert(preferences)
    .values({ userId, data })
    .onConflictDoUpdate({ target: preferences.userId, set: { data } });
}
export async function getNotifications(userId: string): Promise<Notification[]> {
  return (
    await getPool().query(
      "SELECT data FROM notifications WHERE user_id=$1 ORDER BY data->>'createdAt' DESC LIMIT 30",
      [userId],
    )
  ).rows.map((x) => x.data);
}
export async function getJobs(userId: string) {
  return (
    await getPool().query('SELECT * FROM jobs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [
      userId,
    ])
  ).rows.map(mapJob);
}
