import { type RefObject, type UIEventHandler } from 'react';
import {
  ArrowUpRight,
  Bookmark,
  CheckCheck,
  GitBranch,
  Search,
  SlidersHorizontal,
  Sparkles,
  Play,
} from 'lucide-react';
import type { FeedPreview } from '@/shared/types';
import { relativeTime } from '@/shared/feed';
import { itemTypeLabels, platformLabels, sourcePlatform } from '@/shared/platforms';
import { Button } from './ui/button';
import { ItemSources } from './item-sources';
export function FeedList({
  items,
  selectedId,
  view,
  type,
  setType,
  search,
  setSearch,
  unread,
  setUnread,
  select,
  markAll,
  clearFilters,
  sourceName,
  hasUnderlyingItems,
  panelRef,
  onScroll,
  loading,
  total,
  hasMore,
  onLoadMore,
  error,
  retry,
  canMarkRead,
  updatesAvailable,
  onRefresh,
  onAdd,
  onBrowse,
}: {
  items: FeedPreview[];
  selectedId: string | null;
  view: string;
  type: string;
  setType: (v: string) => void;
  search: string;
  setSearch: (v: string) => void;
  unread: boolean;
  setUnread: (v: boolean) => void;
  select: (id: string) => void;
  markAll: () => void;
  clearFilters: () => void;
  sourceName?: string;
  hasUnderlyingItems: boolean;
  panelRef?: RefObject<HTMLElement | null>;
  onScroll?: UIEventHandler<HTMLElement>;
  loading: boolean;
  total: number;
  hasMore: boolean;
  onLoadMore: () => void;
  error: string;
  retry: () => void;
  canMarkRead: boolean;
  updatesAvailable: boolean;
  onRefresh: () => void;
  onAdd: () => void;
  onBrowse: () => void;
}) {
  return (
    <section ref={panelRef} onScroll={onScroll} className="feed-panel" aria-label="更新列表">
      <div className="feed-heading">
        <div className="eyebrow">{view === 'saved' ? 'WORTH KEEPING' : 'THE UPDATE STREAM'}</div>
        <div className="title-row">
          <h1>{view === 'saved' ? '已收藏' : '全部更新'}</h1>
          <span className="count-pill">{total}</span>
        </div>
        <p>
          {view === 'saved' ? '把值得反复阅读的更新，留在这里。' : '你关注的每一次变化，都在这里。'}
        </p>
      </div>
      <div className="search-box">
        <Search size={17} />
        <input
          aria-label="搜索更新"
          placeholder="搜索项目、标题、描述或标签…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="search-hint">搜索</span>
      </div>
      <div className="filter-row">
        <div className="segmented" aria-label="更新类型">
          {[
            ['all', '全部'],
            ['release', '新版本'],
            ['new_repo', '新项目'],
            ['video', '新视频'],
          ].map(([key, label]) => (
            <button
              key={key}
              className={type === key ? 'selected' : ''}
              onClick={() => setType(key)}
              aria-pressed={type === key}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className={`filter-button ${unread ? 'on' : ''}`}
          onClick={() => setUnread(!unread)}
          aria-pressed={unread}
        >
          <SlidersHorizontal size={14} />
          未读
        </button>
      </div>
      {sourceName && (
        <button className="source-filter" onClick={clearFilters}>
          {sourceName} <span>× 清除</span>
        </button>
      )}
      <div className="list-toolbar">
        <span>按发布时间排序</span>
        <button onClick={markAll} disabled={loading || !canMarkRead}>
          <CheckCheck size={14} />
          当前筛选全部标为已读
        </button>
      </div>
      {updatesAvailable && (
        <div className="list-toolbar" role="status">
          <span>列表有变化</span>
          <Button size="small" onClick={onRefresh}>
            查看最新更新
          </Button>
        </div>
      )}
      <div className="update-list">
        {items.map((item) => (
          <button
            key={item.id}
            data-testid={`item-${item.id}`}
            className={`update-card ${selectedId === item.id ? 'selected' : ''} ${item.read ? 'read' : ''}`}
            aria-pressed={selectedId === item.id}
            onClick={() => select(item.id)}
          >
            <div className="card-meta">
              <span className={`repo-avatar ${item.color}`}>
                {item.repo.split('/').pop()?.slice(0, 2).toUpperCase()}
              </span>
              <span className="repo-name">{item.repo}</span>
              {!item.read && <span className="unread-dot" aria-label="未读" />}
              <span className="card-time">{relativeTime(item.publishedAt)}</span>
            </div>
            <h2>{item.title}</h2>
            {item.type === 'video' && item.media?.thumbnailUrl && (
              /* eslint-disable-next-line @next/next/no-img-element -- small lazy remote thumbnails; no image proxy/download */
              <img
                className="video-thumbnail"
                src={item.media.thumbnailUrl}
                alt=""
                width={160}
                height={90}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={(event) => {
                  event.currentTarget.hidden = true;
                }}
              />
            )}
            <ItemSources item={item} />
            <p>
              {item.summary?.overview ||
                item.description ||
                (item.type === 'video'
                  ? '暂无公开简介，可打开原视频查看。'
                  : '项目介绍尚未完善，点击查看已有信息。')}
            </p>
            <div className="card-footer">
              <span className={`type-label ${item.type === 'new_repo' ? 'new' : ''}`}>
                {item.type === 'video' ? (
                  <Play size={12} />
                ) : item.type === 'new_repo' ? (
                  <GitBranch size={12} />
                ) : (
                  <span className="release-dot" />
                )}
                {itemTypeLabels[item.type]}
              </span>
              <span className="topic-tag">
                {item.tags[0] || platformLabels[sourcePlatform(item)]}
              </span>
              {item.demo && <span className="demo-mini">示例</span>}
              {item.backfill && <span className="demo-mini">历史</span>}
              <span className="card-trailing">
                {item.saved ? (
                  <Bookmark size={14} fill="currentColor" />
                ) : item.priority ? (
                  <Sparkles size={13} />
                ) : (
                  <ArrowUpRight size={14} />
                )}
              </span>
            </div>
          </button>
        ))}
      </div>
      {error && (
        <div role="alert" className="empty-state">
          <p>{error}</p>
          <Button onClick={retry}>重试加载</Button>
        </div>
      )}
      {loading && items.length === 0 && (
        <p role="status" className="empty-state">
          正在加载更新…
        </p>
      )}
      {items.length === 0 && !loading && !error && (
        <div className="empty-state">
          <Search size={30} />
          <h3>
            {hasUnderlyingItems
              ? '暂时没有匹配的更新'
              : view === 'saved'
                ? '还没有收藏的更新'
                : '还没有更新'}
          </h3>
          <p>
            {hasUnderlyingItems
              ? '调整关键词或筛选条件，查看其他更新。'
              : view === 'saved'
                ? '收藏的更新会显示在这里。'
                : '添加订阅后，项目发布的更新会显示在这里。'}
          </p>
          {hasUnderlyingItems && (
            <Button variant="secondary" size="small" onClick={clearFilters}>
              清除筛选
            </Button>
          )}
          {!hasUnderlyingItems && (
            <Button variant="secondary" size="small" onClick={view === 'saved' ? onBrowse : onAdd}>
              {view === 'saved' ? '浏览全部更新' : '添加第一份订阅'}
            </Button>
          )}
        </div>
      )}
      {hasMore && (
        <div className="list-end">
          <Button size="small" loading={loading} onClick={onLoadMore}>
            加载更多更新
          </Button>
        </div>
      )}
      {items.length > 0 && !hasMore && (
        <div className="list-end">
          <span />
          已经看到这里的全部更新
          <span />
        </div>
      )}
    </section>
  );
}
