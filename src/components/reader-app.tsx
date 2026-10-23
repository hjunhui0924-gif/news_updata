'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Check,
  ChevronRight,
  Inbox,
  Loader2,
  Plus,
  Radio,
  RefreshCw,
  Settings2,
  Sparkles,
  Bookmark,
  PanelsTopLeft,
  BookOpen,
} from 'lucide-react';
import type { Bootstrap, FeedItem, Preferences } from '@/shared/types';
import { filterItems } from '@/shared/feed';
import { Sidebar } from './sidebar';
import { FeedList } from './feed-list';
import { ItemDetail } from './item-detail';
import { Button } from './ui/button';
import { SubscriptionsPanel, AddSubscription } from './subscriptions-panel';
import { SettingsPanel } from './settings-panel';
import { TrendingPanel } from './trending-panel';
import { GitHubConnection } from './github-connection';
import { SkillsPanel } from './skills-panel';

export async function requestJson<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '操作未完成，请重试。');
  return result;
}

const titles: Record<string, string> = {
  today: '今日精选',
  feed: '全部更新',
  saved: '已收藏',
  subscriptions: '订阅管理',
  skills: 'Skill 目录',
  settings: '偏好设置',
  onboarding: '添加你的第一份关注',
  items: '更新详情',
};
type FeedView = 'feed' | 'saved';
type FeedContext = {
  type: string;
  search: string;
  unread: boolean;
  source: string;
  scrollTop: number;
};
const emptyFeedContext = (): FeedContext => ({
  type: 'all',
  search: '',
  unread: false,
  source: '',
  scrollTop: 0,
});
function normalizeView(path: string) {
  if (path === 'items' || path === 'onboarding') return path === 'items' ? 'feed' : 'subscriptions';
  return path || 'today';
}
function isFeedView(view: string): view is FeedView {
  return view === 'feed' || view === 'saved';
}
export function ReaderApp({
  initial,
  initialView,
  initialItemId,
}: {
  initial: Bootstrap;
  initialView: string;
  initialItemId?: string;
}) {
  const [data, setData] = useState(initial);
  const [view, setView] = useState(
    initialView === 'items' ? 'feed' : initialView === 'onboarding' ? 'subscriptions' : initialView,
  );
  const [selectedId, setSelectedId] = useState<string | null>(initialItemId ?? null);
  const [type, setType] = useState('all');
  const [search, setSearch] = useState('');
  const [unread, setUnread] = useState(false);
  const [source, setSource] = useState('');
  const [addOpen, setAddOpen] = useState(initialView === 'onboarding');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState('');
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [discoveryRefresh, setDiscoveryRefresh] = useState(0);
  const routeTitleRef = useRef<HTMLElement | null>(null);
  const hasMountedRouteRef = useRef(false);
  const feedPanelRef = useRef<HTMLElement | null>(null);
  const feedContexts = useRef<Record<FeedView, FeedContext>>({
    feed: emptyFeedContext(),
    saved: emptyFeedContext(),
  });
  const refresh = useCallback(async () => {
    const next = await requestJson<Bootstrap>('/api/bootstrap');
    setData(next);
    return next;
  }, []);
  const notify = useCallback((message: string) => setToast(message), []);
  function captureFeedContext() {
    if (!isFeedView(view)) return;
    feedContexts.current[view] = {
      type,
      search,
      unread,
      source,
      scrollTop: feedPanelRef.current?.scrollTop ?? feedContexts.current[view].scrollTop,
    };
  }
  function restoreFeedContext(nextView: FeedView) {
    const context = feedContexts.current[nextView];
    setType(context.type);
    setSearch(context.search);
    setUnread(context.unread);
    setSource(context.source);
    requestAnimationFrame(() => {
      if (feedPanelRef.current) feedPanelRef.current.scrollTop = context.scrollTop;
    });
  }
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!hasMountedRouteRef.current) {
      hasMountedRouteRef.current = true;
      return;
    }
    requestAnimationFrame(() => routeTitleRef.current?.focus());
  }, [view, selectedId]);
  useEffect(() => {
    const timer = setInterval(
      () => {
        refresh().catch(() => notify('暂时无法刷新更新，请检查服务连接。'));
      },
      data.jobs.some((x) => x.status === 'pending' || x.status === 'running') ? 1500 : 30000,
    );
    return () => clearInterval(timer);
  }, [data.jobs, refresh, notify]);
  useEffect(() => {
    if (!selectedId) return;
    void requestJson(`/api/items/${selectedId}/state`, 'PATCH', { read: true })
      .then(() =>
        setData((current) => ({
          ...current,
          items: current.items.map((item) =>
            item.id === selectedId ? { ...item, read: true } : item,
          ),
        })),
      )
      .catch((error: Error) => notify(error.message));
  }, [selectedId, notify]);
  useEffect(() => {
    const pop = () => {
      const parts = location.pathname.split('/').filter(Boolean);
      const route = parts[0] || 'today';
      const nextView = normalizeView(route);
      setView(nextView);
      setSelectedId(parts[0] === 'items' ? parts[1] : null);
      setAddOpen(route === 'onboarding');
      if (isFeedView(nextView) && route !== 'items') restoreFeedContext(nextView);
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  const filtered = useMemo(
    () => filterItems(data.items, { view, type, search, unread, source }),
    [data.items, view, type, search, unread, source],
  );
  const selected = data.items.find((item) => item.id === selectedId) ?? null;
  const selectedJobs = data.jobs.filter((job) => job.targetId === selectedId);
  function navigate(next: string) {
    captureFeedContext();
    const nextView = normalizeView(next);
    setView(nextView);
    setSelectedId(null);
    setAddOpen(next === 'onboarding');
    if (isFeedView(nextView)) {
      restoreFeedContext(nextView);
    } else {
      setType('all');
      setSearch('');
      setSource('');
      setUnread(false);
    }
    setNoticeOpen(false);
    history.pushState({}, '', `/${next}`);
  }
  async function patchItem(id: string, patch: Partial<Pick<FeedItem, 'read' | 'saved' | 'muted'>>) {
    const previous = data.items.find((x) => x.id === id);
    try {
      await requestJson(`/api/items/${id}/state`, 'PATCH', patch);
      setData((current) => ({
        ...current,
        items: current.items.map((x) => (x.id === id ? { ...x, ...patch } : x)),
      }));
    } catch (error) {
      if (previous)
        setData((current) => ({
          ...current,
          items: current.items.map((x) => (x.id === id ? previous : x)),
        }));
      notify((error as Error).message);
    }
  }
  function selectItem(id: string) {
    captureFeedContext();
    setSelectedId(id);
    history.pushState({}, '', `/items/${id}`);
  }
  async function execute(key: string, action: () => Promise<unknown>, message?: string) {
    setBusy(key);
    try {
      await action();
      await refresh();
      if (message) notify(message);
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function markAll() {
    await execute(
      'read',
      () =>
        Promise.all(
          filtered
            .filter((x) => !x.read)
            .map((x) => requestJson(`/api/items/${x.id}/state`, 'PATCH', { read: true })),
        ),
      '当前结果已标为已读',
    );
  }
  const summaryBusy =
    !!selected &&
    (busy === `${selected.id}:summary` ||
      selectedJobs.some(
        (job) => job.kind === 'summary' && ['pending', 'running'].includes(job.status),
      ));
  const translationBusy =
    !!selected &&
    (busy === `${selected.id}:translation` ||
      selectedJobs.some(
        (job) => job.kind === 'translation' && ['pending', 'running'].includes(job.status),
      ));
  const navigation = [
    { id: 'today', label: '精选', icon: Sparkles },
    { id: 'feed', label: '更新', icon: Inbox },
    { id: 'saved', label: '收藏', icon: Bookmark },
    { id: 'subscriptions', label: '订阅', icon: PanelsTopLeft },
  ];
  return (
    <div
      className={`app-shell ${data.preferences.compact ? 'compact' : ''} ${selectedId ? 'has-selection' : ''}`}
    >
      <Sidebar
        data={data}
        view={view}
        navigate={navigate}
        onAdd={() => setAddOpen(true)}
        selectSource={(id) => {
          navigate('feed');
          setSource(id);
        }}
      />
      <main className="main-shell">
        <header className="topbar">
          <div className="top-breadcrumb">
            <span className="mobile-brand">
              <Radio size={20} />
              知更
            </span>
            <span className="desktop-workspace">我的工作空间</span>
            <ChevronRight size={13} />
            <strong
              ref={routeTitleRef}
              tabIndex={-1}
              aria-live="polite"
              aria-atomic="true"
            >
              {selectedId ? titles.items : titles[view]}
            </strong>
          </div>
          <div className="top-actions">
            {data.mode === 'demo' && (
              <span className="demo-badge">
                <span />
                演示模式
              </span>
            )}
            <span className="top-date">
              {new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}
            </span>
            <button
              aria-expanded={noticeOpen}
              aria-controls="notice-popover"
              className="icon-button"
              aria-label="通知中心"
              onClick={() => setNoticeOpen(!noticeOpen)}
            >
              <Bell size={18} />
              {data.notifications.length > 0 && <span className="notification-dot" />}
            </button>
            <Button size="small" onClick={() => setAddOpen(true)}>
              <Plus size={15} />
              <span>添加订阅</span>
            </Button>
            <Button
              size="small"
              aria-label="Skill 目录"
              title="Skill 目录"
              onClick={() => navigate('skills')}
            >
              <BookOpen size={15} />
              <span>Skill 目录</span>
            </Button>
          </div>
        </header>
        {noticeOpen && (
          <div id="notice-popover" className="notice-popover" role="dialog" aria-label="通知中心">
            <h3>通知中心</h3>
            {data.notifications.length ? (
              data.notifications.slice(0, 5).map((n) => (
                <div key={n.id}>
                  <strong>{n.subject}</strong>
                  <p>{'站内简报已生成'}</p>
                </div>
              ))
            ) : (
              <p>目前没有通知。你可以在设置中生成更新简报。</p>
            )}
            <Button size="small" onClick={() => navigate('settings')}>
              阅读简报
            </Button>
          </div>
        )}
        {data.mode === 'live' && view !== 'settings' && (
          <GitHubConnection
            key={data.services.githubAuth?.state}
            banner
            status={data.services.githubAuth}
            onChecked={refresh}
          />
        )}
        {view === 'skills' ? (
          <SkillsPanel />
        ) : view === 'today' ? (
          <TrendingPanel
            subscriptions={data.subscriptions}
            aiEnabled={data.services.ai}
            timezone={data.preferences.timezone}
            onSubscribed={refresh}
            refreshVersion={discoveryRefresh}
          />
        ) : ['feed', 'saved'].includes(view) ? (
          <div className="reader-grid">
            <FeedList
              items={filtered}
              selectedId={selectedId}
              view={view}
              type={type}
              setType={setType}
              search={search}
              setSearch={setSearch}
              unread={unread}
              setUnread={setUnread}
              select={selectItem}
              markAll={markAll}
              hasUnderlyingItems={data.items.some(
                (item) => !item.muted && (view !== 'saved' || item.saved),
              )}
              sourceName={data.subscriptions.find((x) => x.id === source)?.name}
              panelRef={feedPanelRef}
              onScroll={(event) => {
                if (isFeedView(view)) feedContexts.current[view].scrollTop = event.currentTarget.scrollTop;
              }}
              clearFilters={() => {
                setSource('');
                setSearch('');
                setType('all');
                setUnread(false);
              }}
            />
            <ItemDetail
              key={selected?.id ?? 'empty'}
              aiEnabled={data.services.ai}
              item={selected}
              timezone={data.preferences.timezone}
              projectSubscribed={
                !!selected &&
                data.subscriptions.some(
                  (subscription) =>
                    subscription.kind === 'repo' &&
                    subscription.name.toLowerCase() === selected.repo.toLowerCase(),
                )
              }
              projectSubscribeBusy={busy === 'subscribe-project'}
              subscribeProject={
                selected?.type === 'new_repo'
                  ? () =>
                      void execute(
                        'subscribe-project',
                        () =>
                          requestJson('/api/subscriptions', 'POST', {
                            kind: 'repo',
                            input: selected.repo,
                          }),
                        '项目订阅已添加，正在获取更新',
                      )
                  : undefined
              }
              toggleSaved={() =>
                selected && void patchItem(selected.id, { saved: !selected.saved })
              }
              translate={() =>
                selected &&
                void execute(
                  `${selected.id}:translation`,
                  () => requestJson(`/api/items/${selected.id}/translation`, 'POST', {}),
                  '翻译任务已提交',
                )
              }
              summarize={() =>
                selected &&
                void execute(
                  `${selected.id}:summary`,
                  () => requestJson(`/api/items/${selected.id}/summary/retry`, 'POST', {}),
                  '摘要任务已提交',
                )
              }
              summaryBusy={summaryBusy}
              translationBusy={translationBusy}
              errors={{
                summary:
                  selectedJobs.find((job) => job.kind === 'summary' && job.status === 'failed')
                    ?.error,
                translation:
                  selectedJobs.find(
                    (job) => job.kind === 'translation' && job.status === 'failed',
                  )?.error,
              }}
              back={() => {
                setSelectedId(null);
                if (isFeedView(view)) restoreFeedContext(view);
                history.pushState({}, '', `/${view}`);
              }}
            />
          </div>
        ) : view === 'subscriptions' ? (
          <SubscriptionsPanel
            onViewSource={(id) => {
              navigate('feed');
              setSource(id);
            }}
            subscriptions={data.subscriptions}
            starSync={data.starSync}
            showStarSync={data.mode === 'live' || !!data.starSync}
            workerOnline={data.services.workerOnline}
            onStarAction={(action) =>
              execute(
                'stars',
                () =>
                  requestJson(
                    '/api/github/starred/auto',
                    action === 'check' ? 'POST' : 'PATCH',
                    action === 'check' ? undefined : { enabled: action === 'enable' },
                  ),
                action === 'check'
                  ? 'Star 检查已加入队列'
                  : action === 'enable'
                    ? 'Star 自动跟踪已开启'
                    : 'Star 自动跟踪已关闭',
              )
            }
            jobs={data.jobs}
            onAdd={() => setAddOpen(true)}
            onAction={(id, action) =>
              execute(
                id,
                () =>
                  requestJson(
                    `/api/subscriptions/${id}${action === 'sync' ? '/sync' : ''}`,
                    action === 'sync' ? 'POST' : action === 'delete' ? 'DELETE' : 'PATCH',
                    action === 'sync' || action === 'delete'
                      ? {}
                      : action === 'pause'
                        ? { enabled: false }
                        : action === 'resume'
                          ? { enabled: true }
                          : { priority: !data.subscriptions.find((x) => x.id === id)?.priority },
                  ),
                action === 'sync' ? '同步任务已加入队列' : '订阅已更新',
              )
            }
            busy={busy}
          />
        ) : (
          <SettingsPanel
            onAuthChecked={refresh}
            data={data}
            busy={busy}
            save={(preferences: Preferences) =>
              execute(
                'settings',
                () => requestJson('/api/settings', 'PATCH', preferences),
                '偏好已保存',
              )
            }
            preview={() =>
              execute(
                'digest',
                () => requestJson('/api/notifications/preview', 'POST', {}),
                '更新简报已生成',
              )
            }
            notify={notify}
          />
        )}
        <div className="connection-strip">
          <span>
            <span className="online-dot" />
            {data.mode === 'demo' ? '24 条固定示例 · 可添加真实 GitHub 订阅' : 'GitHub 公开数据'}
          </span>
          <button
            onClick={() => {
              setDiscoveryRefresh((x) => x + 1);
              void execute('refresh', refresh, '内容已刷新');
            }}
          >
            {busy === 'refresh' ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
            刷新内容
          </button>
        </div>
      </main>
      <nav className="mobile-nav" aria-label="移动导航">
        {navigation.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => navigate(id)}
            className={view === id ? 'active' : ''}
            aria-current={view === id ? 'page' : undefined}
          >
            <Icon size={19} />
            <span>{label}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => navigate('settings')}
          className={view === 'settings' ? 'active' : ''}
          aria-current={view === 'settings' ? 'page' : undefined}
        >
          <Settings2 size={19} />
          <span>设置</span>
        </button>
      </nav>
      <AddSubscription
        open={addOpen}
        onOpenChange={setAddOpen}
        authorSubscriptionCount={data.subscriptions.filter((subscription) => subscription.kind === 'author').length}
        onAdded={async () => {
          await refresh();
          notify('订阅已添加，正在获取更新');
        }}
      />
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}
