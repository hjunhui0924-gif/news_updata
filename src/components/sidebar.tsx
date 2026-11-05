import { useState } from 'react';
import {
  Radio,
  Sparkles,
  Inbox,
  Bookmark,
  PanelsTopLeft,
  Settings2,
  Plus,
  ChevronDown,
  Circle,
  CodeXml as Github,
  ArrowUpRight,
  BookOpen,
  MoreHorizontal,
  Play,
} from 'lucide-react';
import type { Bootstrap } from '@/shared/types';
const nav = [
  { id: 'saved', label: '已收藏', icon: Bookmark },
  { id: 'subscriptions', label: '订阅管理', icon: PanelsTopLeft },
];
export function Sidebar({
  data,
  view,
  unread,
  platform,
  idPrefix,
  navigate,
  onFeedView,
  onPlatform,
  onAdd,
  selectSource,
}: {
  data: Bootstrap;
  view: string;
  unread: boolean;
  platform: string;
  idPrefix: string;
  navigate: (view: string) => void;
  onFeedView: (unreadOnly: boolean) => void;
  onPlatform: (platform: string) => void;
  onAdd: () => void;
  selectSource: (id: string) => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const enabledSources = data.subscriptions.filter((source) => source.enabled);
  return (
    <aside className="sidebar">
      <button className="brand" onClick={() => navigate('today')} aria-label="知更首页">
        <span className="brand-icon">
          <Radio size={23} />
        </span>
        <span>
          知更<span className="brand-sub">NEWSROOM</span>
        </span>
      </button>
      <button className="workspace-switch" onClick={() => navigate('settings')}>
        <span className="workspace-avatar">我</span>
        <span>我的工作空间</span>
        <ChevronDown size={14} />
      </button>
      <div className="nav-caption">工作空间</div>
      <nav className="main-nav" aria-label="主导航">
        <button
          className={`nav-item ${view === 'feed' && !unread ? 'active' : ''}`}
          aria-current={view === 'feed' && !unread ? 'page' : undefined}
          onClick={() => onFeedView(false)}
        >
          <Inbox size={18} />
          <span>全部更新</span>
          <span className="nav-count">
            {data.feed?.unread ?? data.items.filter((x) => !x.read && !x.muted).length}
          </span>
        </button>
        <button
          className={`nav-item ${view === 'feed' && unread ? 'active' : ''}`}
          aria-current={view === 'feed' && unread ? 'page' : undefined}
          onClick={() => onFeedView(true)}
        >
          <Circle size={18} />
          <span>未读更新</span>
          <span className="nav-count">
            {data.feed?.unread ?? data.items.filter((x) => !x.read && !x.muted).length}
          </span>
        </button>
        {nav.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`nav-item ${view === id ? 'active' : ''}`}
            aria-current={view === id ? 'page' : undefined}
            onClick={() => navigate(id)}
          >
            <Icon size={18} />
            <span>{label}</span>
            {id === 'saved' && (
              <span className="nav-count">
                {data.feed?.saved ?? data.items.filter((x) => x.saved && !x.muted).length}
              </span>
            )}
          </button>
        ))}
      </nav>
      <div className="nav-caption source-caption">
        <span>平台</span>
      </div>
      <nav className="platform-nav" aria-label="平台导航">
        {[
          { id: 'github', label: 'GitHub', icon: Github },
          { id: 'youtube', label: 'YouTube', icon: Play },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`source-link ${view === 'feed' && platform === id ? 'active' : ''}`}
            aria-pressed={view === 'feed' && platform === id}
            onClick={() => onPlatform(id)}
          >
            <Icon size={16} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="nav-caption source-caption source-group-heading">
        <button
          className="source-group-toggle"
          aria-label="订阅来源"
          aria-expanded={sourcesOpen}
          aria-controls={`sidebar-sources-${idPrefix}`}
          onClick={() => setSourcesOpen((open) => !open)}
        >
          <ChevronDown
            size={14}
            className={sourcesOpen ? 'source-chevron open' : 'source-chevron'}
          />
          <span>订阅来源</span>
          <span
            className="source-group-count"
            aria-label={`${enabledSources.length} 个正在关注的来源`}
          >
            {enabledSources.length}
          </span>
        </button>
        <button className="tiny-action" onClick={onAdd} aria-label="添加订阅">
          <Plus size={15} />
        </button>
      </div>
      <nav
        className="sidebar-sources"
        id={`sidebar-sources-${idPrefix}`}
        aria-label="订阅来源"
        hidden={!sourcesOpen}
      >
        {enabledSources.slice(0, 6).map((sub) => (
          <button className="source-link" key={sub.id} onClick={() => selectSource(sub.id)}>
            {sub.kind === 'channel' ? <Play size={15} /> : <Github size={15} />}
            <span>{sub.kind === 'repo' ? sub.name.split('/').pop() : sub.name}</span>
            {sub.priority && <span className="source-dot" />}
          </button>
        ))}
        {!enabledSources.length && (
          <p className="helper">
            {data.subscriptions.length
              ? '订阅已全部暂停，可在订阅管理中恢复。'
              : '还没有订阅，添加第一个吧。'}
          </p>
        )}
        {enabledSources.length > 6 && (
          <button className="source-link source-view-all" onClick={() => navigate('subscriptions')}>
            <PanelsTopLeft size={15} />
            <span>查看全部 {enabledSources.length} 个来源</span>
          </button>
        )}
      </nav>
      <button className="add-source" onClick={onAdd}>
        <Plus size={16} />
        添加关注的来源
      </button>
      <div className="sidebar-bottom">
        <div className="more-tools">
          <button
            className="nav-item"
            aria-expanded={moreOpen}
            aria-controls={`sidebar-more-tools-${idPrefix}`}
            onClick={() => setMoreOpen((open) => !open)}
          >
            <MoreHorizontal size={18} />
            <span>更多工具</span>
            <ChevronDown size={14} className={moreOpen ? 'more-chevron open' : 'more-chevron'} />
          </button>
          {moreOpen && (
            <div className="more-tools-list" id={`sidebar-more-tools-${idPrefix}`}>
              <button
                onClick={() => navigate('today')}
                aria-current={view === 'today' ? 'page' : undefined}
              >
                <Sparkles size={15} />
                <span>今日精选</span>
              </button>
              <button
                onClick={() => navigate('skills')}
                aria-current={view === 'skills' ? 'page' : undefined}
              >
                <BookOpen size={15} />
                <span>Skill 目录</span>
                <ArrowUpRight size={13} />
              </button>
            </div>
          )}
        </div>
        <button
          className={`nav-item ${view === 'settings' ? 'active' : ''}`}
          aria-current={view === 'settings' ? 'page' : undefined}
          onClick={() => navigate('settings')}
        >
          <Settings2 size={18} />
          <span>偏好设置</span>
          <ArrowUpRight size={14} />
        </button>
        <div className="user-row">
          <span className="user-avatar">N</span>
          <div>
            <strong>{data.mode === 'demo' ? '体验工作空间' : data.user.name}</strong>
            <span>{data.mode === 'demo' ? '本地演示 · 数据已标注' : 'GitHub 已连接'}</span>
          </div>
          <span className="online-dot" />
        </div>
      </div>
    </aside>
  );
}
