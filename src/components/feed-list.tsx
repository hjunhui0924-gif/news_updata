import { useState } from 'react';
import {
  ArrowUpRight,
  Bookmark,
  CheckCheck,
  GitBranch,
  Search,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import type { FeedItem } from '@/shared/types';
import { relativeTime } from '@/shared/feed';
import { Button } from './ui/button';
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
  clearSource,
  sourceName,
}: {
  items: FeedItem[];
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
  clearSource: () => void;
  sourceName?: string;
}) {
  const [limit, setLimit] = useState(20);
  return (
    <section className="feed-panel" aria-label="更新列表">
      <div className="feed-heading">
        <div className="eyebrow">{view === 'saved' ? 'WORTH KEEPING' : 'THE UPDATE STREAM'}</div>
        <div className="title-row">
          <h1>{view === 'saved' ? '已收藏' : '全部更新'}</h1>
          <span className="count-pill">{items.length}</span>
        </div>
        <p>
          {view === 'saved' ? '把值得反复阅读的更新，留在这里。' : '你关注的每一次变化，都在这里。'}
        </p>
      </div>
      <div className="search-box">
        <Search size={17} />
        <input
          aria-label="搜索更新"
          placeholder="搜索项目、作者或更新内容…"
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
        <button className="source-filter" onClick={clearSource}>
          {sourceName} <span>× 清除</span>
        </button>
      )}
      <div className="list-toolbar">
        <span>按发布时间排序</span>
        <button onClick={markAll} disabled={!items.some((x) => !x.read)}>
          <CheckCheck size={14} />
          当前结果标为已读
        </button>
      </div>
      <div className="update-list">
        {items.slice(0, limit).map((item) => (
          <button
            key={item.id}
            data-testid={`item-${item.id}`}
            className={`update-card ${selectedId === item.id ? 'selected' : ''} ${item.read ? 'read' : ''}`}
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
            <p>
              {item.summary?.overview || item.description || '项目介绍尚未完善，点击查看已有信息。'}
            </p>
            <div className="card-footer">
              <span className={`type-label ${item.type === 'new_repo' ? 'new' : ''}`}>
                {item.type === 'new_repo' ? (
                  <GitBranch size={12} />
                ) : (
                  <span className="release-dot" />
                )}
                {item.type === 'new_repo' ? '新项目' : '版本发布'}
              </span>
              <span className="topic-tag">{item.tags[0] || '开源项目'}</span>
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
      {items.length === 0 && (
        <div className="empty-state">
          <Search size={30} />
          <h3>暂时没有匹配的更新</h3>
          <p>试试其他关键词，或切换到全部更新。</p>
        </div>
      )}
      {items.length > limit && (
        <div className="list-end">
          <Button size="small" onClick={() => setLimit(limit + 20)}>
            加载更多更新
          </Button>
        </div>
      )}
      {items.length > 0 && items.length <= limit && (
        <div className="list-end">
          <span />
          已经看到这里的全部更新
          <span />
        </div>
      )}
      <Button className="mobile-subscribe" size="small" onClick={clearSource}>
        查看所有来源
      </Button>
    </section>
  );
}
