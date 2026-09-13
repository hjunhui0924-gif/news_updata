'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  settings: '偏好设置',
  onboarding: '添加你的第一份关注',
  items: '更新详情',
};
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
  const refresh = useCallback(async () => {
    const next = await requestJson<Bootstrap>('/api/bootstrap');
    setData(next);
    return next;
  }, []);
  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
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
      setView(parts[0] === 'items' ? 'feed' : parts[0] || 'today');
      setSelectedId(parts[0] === 'items' ? parts[1] : null);
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  const filtered = useMemo(
    () => filterItems(data.items, { view, type, search, unread, source }),
    [data.items, view, type, search, unread, source],
  );
  const selected = data.items.find((item) => item.id === selectedId) ?? null;
  function navigate(next: string) {
    setView(next);
    setSelectedId(null);
    setType('all');
    setSearch('');
    setSource('');
    setUnread(false);
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
  const busyAi =
    !!selected &&
    (busy === selected.id ||
      data.jobs.some(
        (x) => x.targetId === selected.id && ['pending', 'running'].includes(x.status),
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
            <strong>{titles[view]}</strong>
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
          </div>
        </header>
        {noticeOpen && (
          <div className="notice-popover">
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
        {view === 'today' ? (
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
              sourceName={data.subscriptions.find((x) => x.id === source)?.name}
              clearSource={() => {
                setSource('');
                setSearch('');
                setType('all');
              }}
            />
            <ItemDetail
              key={selected?.id ?? 'empty'}
              aiEnabled={data.services.ai}
              item={selected}
              timezone={data.preferences.timezone}
              toggleSaved={() =>
                selected && void patchItem(selected.id, { saved: !selected.saved })
              }
              translate={() =>
                selected &&
                void execute(
                  selected.id,
                  () => requestJson(`/api/items/${selected.id}/translation`, 'POST', {}),
                  '翻译任务已提交',
                )
              }
              summarize={() =>
                selected &&
                void execute(
                  selected.id,
                  () => requestJson(`/api/items/${selected.id}/summary/retry`, 'POST', {}),
                  '摘要任务已提交',
                )
              }
              busy={busyAi}
              error={
                data.jobs.find(
                  (job) =>
                    job.targetId === selected?.id &&
                    (job.kind === 'summary' || job.kind === 'translation'),
                )?.status === 'failed'
                  ? data.jobs.find(
                      (job) =>
                        job.targetId === selected?.id &&
                        (job.kind === 'summary' || job.kind === 'translation'),
                    )?.error
                  : null
              }
              back={() => {
                setSelectedId(null);
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
          <button key={id} onClick={() => navigate(id)} className={view === id ? 'active' : ''}>
            <Icon size={19} />
            <span>{label}</span>
          </button>
        ))}
        <button
          onClick={() => navigate('settings')}
          className={view === 'settings' ? 'active' : ''}
        >
          <Settings2 size={19} />
          <span>设置</span>
        </button>
      </nav>
      <AddSubscription
        open={addOpen}
        onOpenChange={setAddOpen}
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
