import { pgTable, text, timestamp, boolean, jsonb, uniqueIndex } from 'drizzle-orm/pg-core';
import type { FeedItem, Subscription, Preferences } from '@/shared/types';

export const users = pgTable('app_users', { id: text().primaryKey(), name: text().notNull() });
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: text().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    externalId: text('external_id').notNull(),
    kind: text().notNull(),
    data: jsonb().$type<Subscription>().notNull(),
  },
  (t) => [uniqueIndex('subscription_identity').on(t.userId, t.kind, t.externalId)],
);
export const items = pgTable(
  'items',
  {
    id: text().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    sourceId: text('source_id').notNull(),
    externalKey: text('external_key').notNull(),
    data: jsonb().$type<FeedItem>().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    read: boolean().notNull().default(false),
    saved: boolean().notNull().default(false),
    muted: boolean().notNull().default(false),
  },
  (t) => [uniqueIndex('item_identity').on(t.userId, t.externalKey)],
);
export const preferences = pgTable('preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id),
  data: jsonb().$type<Preferences>().notNull(),
});
