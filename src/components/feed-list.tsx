import {
  Fragment,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
  type UIEventHandler,
} from 'react';
import {
  ArrowUpRight,
  Bookmark,
  CheckCheck,
  GitBranch,
  Search,
  SlidersHorizontal,
  Sparkles,
  Play,
  CodeXml as Github,
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
  platform,
  setPlatform,
  timezone,
  layoutControl,
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
  platform: string;
  setPlatform: (v: string) => void;
  timezone: string;
  layoutControl: ReactNode;
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
  const listRef = useRef<HTMLDivElement>(null);
  const focusedItem = useRef<string | null>(null);
  useLayoutEffect(() => {
    // Moving a card across a layout batch must not lose a keyboard user's focus.
    if (focusedItem.current && document.activeElement === document.body)
      listRef.current
        ?.querySelector<HTMLButtonElement>(
          `[data-testid="${CSS.escape(`item-${focusedItem.current}`)}"]`,
        )
        ?.focus({ preventScroll: true });
  }, [items]);
  const batches = Array.from({ length: Math.ceil(items.length / 30) }, (_, index) =>
    items.slice(index * 30, (index + 1) * 30),
  );
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
    [timezone],
  );
  const dateKey = useCallback(
    (value: string) => {
      const parts = dateFormatter.formatToParts(new Date(value));
      const part = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((entry) => entry.type === type)?.value ?? '';
      return `${part('year')}-${part('month')}-${part('day')}`;
    },
    [dateFormatter],
  );
  const formatGroupDate = (key: string) => {
    const today = dateKey(new Date().toISOString());
    const [year, month, day] = today.split('-').map(Number);
    const yesterdayDate = new Date(Date.UTC(year, month - 1, day - 1));
    const yesterday = `${yesterdayDate.getUTCFullYear()}-${String(yesterdayDate.getUTCMonth() + 1).padStart(2, '0')}-${String(yesterdayDate.getUTCDate()).padStart(2, '0')}`;
    if (key === today) return '今天';
    if (key === yesterday) return '昨天';
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone,
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    }).format(new Date(`${key}T12:00:00Z`));
  };
  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const key = dateKey(item.publishedAt);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [dateKey, items]);
  let previousDay = '';
  return (
    <section ref={panelRef} onScroll={onScroll} className="feed-panel" aria-label="更新列表">
      <div className="feed-heading">
        <div className="title-row">
          <h1>{view === 'saved' ? '已收藏' : unread ? '未读更新' : '全部更新'}</h1>
          <span className="count-pill">{total}</span>
        </div>
        <p>
          {view === 'saved' ? '把值得反复阅读的更新，留在这里。' : '你关注的每一次变化，都在这里。'}
        </p>
      </div>
      <div className="feed-search-row">
        <div className="search-box">
          <Search size={18} />
          <input
            aria-label="搜索更新"
            placeholder="搜索项目、标题、描述或标签…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {layoutControl}
      </div>
      <div className="feed-filter-bar">
        <div className="segmented platform-segmented" role="group" aria-label="平台筛选">
          {[
            ['all', '全部平台'],
            ['github', 'GitHub'],
            ['youtube', 'YouTube'],
          ].map(([key, label]) => (
            <button
              key={key}
              className={platform === key ? 'selected' : ''}
              onClick={() => setPlatform(key)}
              aria-pressed={platform === key}
            >
              {key === 'github' ? (
                <Github size={13} />
              ) : key === 'youtube' ? (
                <Play size={12} />
              ) : null}
              {label}
            </button>
          ))}
        </div>
        <div className="segmented type-segmented" role="group" aria-label="内容类型">
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
          aria-label="未读"
          title="仅显示未读更新"
        >
          <SlidersHorizontal size={16} />
          <span className="filter-button-label">未读</span>
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
      <div className="update-list" ref={listRef}>
        {batches.map((batch, index) => (
          <div
            className="update-batch"
            key={index}
            style={{ containIntrinsicSize: `auto ${batch.length * 220 - 10}px` }}
          >
            {batch.map((item) => {
              const itemDay = dateKey(item.publishedAt);
              const showDate = itemDay !== previousDay;
              previousDay = itemDay;
              const PlatformIcon = sourcePlatform(item) === 'youtube' ? Play : Github;
              return (
                <Fragment key={item.id}>
                  {showDate && (
                    <h3 className="feed-day-heading">
                      {formatGroupDate(itemDay)}
                      <span>{groupCounts.get(itemDay)} 条</span>
                    </h3>
                  )}
                  <button
                    data-testid={`item-${item.id}`}
                    className={`update-card ${selectedId === item.id ? 'selected' : ''} ${item.read ? 'read' : ''}`}
                    aria-pressed={selectedId === item.id}
                    onClick={() => select(item.id)}
                    onFocus={() => {
                      focusedItem.current = item.id;
                    }}
                    onBlur={() => {
                      focusedItem.current = null;
                    }}
                  >
                    <div className="card-meta">
                      <span className={`platform-label ${sourcePlatform(item)}`}>
                        <PlatformIcon size={14} />
                        {platformLabels[sourcePlatform(item)]}
                      </span>
                      <span className="repo-name" title={item.repo}>
                        {item.repo}
                      </span>
                      {!item.read && <span className="unread-dot" aria-label="未读" />}
                      <span className="card-time">{relativeTime(item.publishedAt)}</span>
                    </div>
                    <h2 title={item.title}>{item.title}</h2>
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
                </Fragment>
              );
            })}
          </div>
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
