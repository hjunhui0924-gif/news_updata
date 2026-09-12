import { createHash } from 'node:crypto';
import { getItems, getPreferences, getSubscriptions } from '../db/store';
import { getPool } from '../db/client';
import type { FeedItem, Notification } from '@/shared/types';

export function digestItems(items: FeedItem[], now = Date.now()) {
  return items
    .filter(
      (x) => !x.read && !x.muted && !x.backfill && Date.parse(x.publishedAt) >= now - 7 * 86400000,
    )
    .sort(
      (a, b) =>
        Number(b.priority) - Number(a.priority) ||
        Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
    )
    .slice(0, 10);
}
export async function buildDigest(userId: string) {
  const [all, preferences, subscriptions] = await Promise.all([
    getItems(userId),
    getPreferences(userId),
    getSubscriptions(userId),
  ]);
  const priority = new Map(subscriptions.map((x) => [x.id, x.priority]));
  const items = digestItems(
    all.map((x) => ({ ...x, priority: priority.get(x.sourceId) ?? false })),
  );
  const date = new Date().toLocaleDateString('zh-CN', {
    timeZone: preferences.timezone,
    month: 'long',
    day: 'numeric',
  });
  const subject = `${date} · 我的更新简报`;
  const sections = items.map(
    (item) =>
      `## ${item.repo}${item.demo ? ' · 演示样本' : ''}\n\n**${item.title.replace(/[\n\r]/g, ' ')}**\n\n${item.summary?.overview || item.description || '暂无中文摘要，可查看原文。'}\n\n[${item.demo ? '查看参考项目' : '查看来源'}](${item.url})`,
  );
  const body = `# ${subject}\n\n${items.length ? `从最近 7 天的未读更新中选出 ${items.length} 条，优先展示重点项目。` : '近期没有待阅读的新更新。历史导入内容仍可在全部更新中查看。'}\n\n${sections.join('\n\n---\n\n')}`;
  const key = createHash('sha256').update(`${userId}:${body}`).digest('hex');
  const data: Notification = {
    id: key,
    subject,
    body,
    itemIds: items.map((x) => x.id),
    status: 'preview',
    createdAt: new Date().toISOString(),
    error: null,
  };
  await getPool().query(
    'INSERT INTO notifications(id,user_id,period_key,data) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,period_key) DO UPDATE SET data=excluded.data',
    [key, userId, key, data],
  );
  return data;
}
