import {
  Radio,
  Sparkles,
  Inbox,
  Bookmark,
  PanelsTopLeft,
  Settings2,
  Plus,
  ChevronDown,
  CodeXml as Github,
  ArrowUpRight,
  CircleHelp,
  BookOpen,
} from 'lucide-react';
import type { Bootstrap } from '@/shared/types';
const nav = [
  { id: 'today', label: '今日精选', icon: Sparkles },
  { id: 'feed', label: '全部更新', icon: Inbox },
  { id: 'saved', label: '已收藏', icon: Bookmark },
  { id: 'skills', label: 'Skill 目录', icon: BookOpen },
];
export function Sidebar({
  data,
  view,
  navigate,
  onAdd,
  selectSource,
}: {
  data: Bootstrap;
  view: string;
  navigate: (view: string) => void;
  onAdd: () => void;
  selectSource: (id: string) => void;
}) {
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
        {nav.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`nav-item ${view === id ? 'active' : ''}`}
            onClick={() => navigate(id)}
          >
            <Icon size={18} />
            <span>{label}</span>
            {id === 'feed' && (
              <span className="nav-count">
                {data.items.filter((x) => !x.read && !x.muted).length}
              </span>
            )}
            {id === 'saved' && (
              <span className="nav-count">
                {data.items.filter((x) => x.saved && !x.muted).length}
              </span>
            )}
          </button>
        ))}
        <button
          className={`nav-item ${view === 'subscriptions' ? 'active' : ''}`}
          onClick={() => navigate('subscriptions')}
        >
          <PanelsTopLeft size={18} />
          <span>订阅管理</span>
        </button>
      </nav>
      <div className="nav-caption source-caption">
        <span>我的订阅</span>
        <button className="tiny-action" onClick={onAdd} aria-label="添加订阅">
          <Plus size={15} />
        </button>
      </div>
      <div className="sidebar-sources">
        {data.subscriptions
          .filter((x) => x.enabled)
          .slice(0, 6)
          .map((sub) => (
            <button className="source-link" key={sub.id} onClick={() => selectSource(sub.id)}>
              <Github size={15} />
              <span>{sub.name.split('/').pop()}</span>
              {sub.priority && <span className="source-dot" />}
            </button>
          ))}
        {!data.subscriptions.length && <p className="helper">还没有订阅，添加第一个吧。</p>}
      </div>
      <button className="add-source" onClick={onAdd}>
        <Plus size={16} />
        添加关注的人或项目
      </button>
      <div className="sidebar-bottom">
        <div className="quiet-note">
          <span className="quiet-icon">
            <CircleHelp size={17} />
          </span>
          <p>
            少一点信息噪声，
            <br />
            多一点值得关注的变化。
          </p>
        </div>
        <button
          className={`nav-item ${view === 'settings' ? 'active' : ''}`}
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
