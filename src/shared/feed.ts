import type { FeedItem, FeedPreview } from './types';
export function toFeedPreview(item: FeedItem | FeedPreview): FeedPreview {
  const rest = { ...item };
  for (const key of ['body', 'contentHash', 'translation', 'translationBlocks', 'aiError'] as const)
    delete (rest as Partial<FeedItem>)[key];
  const summary = item.summary;
  return {
    ...rest,
    summary: summary ? { overview: summary.overview.slice(0, 400) } : null,
  };
}
export function itemSourceIds(item: Pick<FeedItem, 'sourceId' | 'sourceIds'>): string[] {
  return [...new Set([item.sourceId, ...(item.sourceIds ?? [])])];
}
export function filterItems<T extends FeedPreview>(
  items: T[],
  filters: {
    view: string;
    type: string;
    search: string;
    unread: boolean;
    source: string;
    now?: number;
  },
) {
  const query = filters.search.trim().toLowerCase();
  return items.filter((item) => {
    if (item.muted) return false;
    if (filters.view === 'saved' && !item.saved) return false;
    if (filters.view === 'today') return false; // Discovery has its own Trending data source.
    if (filters.unread && item.read) return false;
    if (filters.type !== 'all' && item.type !== filters.type) return false;
    if (filters.source && !itemSourceIds(item).includes(filters.source)) return false;
    return (
      !query ||
      `${item.title} ${item.repo} ${item.description} ${item.tags.join(' ')}`
        .toLowerCase()
        .includes(query)
    );
  });
}
export function relativeTime(value: string) {
  const hours = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 3600000));
  return hours < 1 ? '刚刚' : hours < 24 ? `${hours} 小时前` : `${Math.floor(hours / 24)} 天前`;
}
