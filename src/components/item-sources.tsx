import type { FeedItem } from '@/shared/types';

export function ItemSources({ item }: { item: FeedItem }) {
  if (!item.matchedSources?.length) return null;
  return (
    <div className="item-sources" aria-label="关注来源">
      {item.matchedSources.map((source) => (
        <span key={source.id}>
          {source.kind === 'author' ? '关注博主' : '订阅项目'} · {source.name}
        </span>
      ))}
    </div>
  );
}
