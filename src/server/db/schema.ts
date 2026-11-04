import {
  pgTable,
  text,
  timestamp,
  boolean,
  jsonb,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import type { FeedItem, Subscription, Preferences } from '@/shared/types';
import { sql } from 'drizzle-orm';

export const users = pgTable('app_users', { id: text().primaryKey(), name: text().notNull() });
export const platformConnections = pgTable(
  'platform_connections',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    platform: text().notNull(),
    externalId: text('external_id'),
    name: text(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true }),
    scope: text(),
    clientFingerprint: text('client_fingerprint'),
    generation: text().notNull(),
    oauthNonce: text('oauth_nonce'),
    state: text().notNull().default('disconnected'),
    retryAt: timestamp('retry_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.platform] })],
);
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: text().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    externalId: text('external_id').notNull(),
    platform: text().notNull().default('github'),
    kind: text().notNull(),
    data: jsonb().$type<Subscription>().notNull(),
  },
  (t) => [uniqueIndex('subscription_identity').on(t.userId, t.platform, t.kind, t.externalId)],
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
    searchText: text('search_text').generatedAlwaysAs(sql`feed_search_text(data)`),
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
