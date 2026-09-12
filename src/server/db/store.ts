import { desc, eq, and } from 'drizzle-orm';
import { getDb, getPool } from './client';
import { items, subscriptions, preferences } from './schema';
import type { FeedItem, Preferences, Subscription, Notification } from '@/shared/types';
import { mapJob } from '../jobs/queue';

export const defaultPreferences: Preferences = { timezone: 'Asia/Shanghai', compact: false };

export async function getItems(userId: string): Promise<FeedItem[]> {
  const rows = await getDb()
    .select()
    .from(items)
    .where(eq(items.userId, userId))
    .orderBy(desc(items.publishedAt), desc(items.id));
  return rows.map((row) => ({ ...row.data, read: row.read, saved: row.saved, muted: row.muted }));
}
export async function getItem(userId: string, id: string) {
  const rows = await getDb()
    .select()
    .from(items)
    .where(and(eq(items.userId, userId), eq(items.id, id)))
    .limit(1);
  if (!rows[0]) return null;
  return { ...rows[0].data, read: rows[0].read, saved: rows[0].saved, muted: rows[0].muted };
}
export async function saveItem(userId: string, item: FeedItem) {
  await getDb()
    .insert(items)
    .values({
      id: item.id,
      userId,
      sourceId: item.sourceId,
      externalKey: `${item.type}:${item.externalId}`,
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
  return (await getDb().select().from(subscriptions).where(eq(subscriptions.userId, userId))).map(
    (row) => row.data,
  );
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
    .values({ id: data.id, userId, externalId: data.externalId, kind: data.kind, data })
    .onConflictDoUpdate({
      target: [subscriptions.userId, subscriptions.kind, subscriptions.externalId],
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
