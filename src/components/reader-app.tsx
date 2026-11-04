'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import type { Bootstrap, FeedItem, FeedPreview, FeedPage, Preferences } from '@/shared/types';
import { Sidebar } from './sidebar';
import { FeedList } from './feed-list';
import { ItemDetail } from './item-detail';
import { Button } from './ui/button';
import { SubscriptionsPanel, AddSubscription } from './subscriptions-panel';
import { SettingsPanel } from './settings-panel';
import { TrendingPanel } from './trending-panel';
import { GitHubConnection } from './github-connection';
import { SkillsPanel } from './skills-panel';
import { useFeed, feedParams } from './use-feed';

import { requestJson } from './request-json';
import { startPolling } from './polling';
import { toFeedPreview } from '@/shared/feed';
import { sourcePlatform } from '@/shared/platforms';
export { requestJson } from './request-json';

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
  const itemCache = useRef(
    new Map([
      ...initial.items.map((item) => [item.id, item] as const),
      ...(initial.selectedItem
        ? [[initial.selectedItem.id, toFeedPreview(initial.selectedItem)] as const]
        : []),
    ]),
  );
  const [detail, setDetail] = useState<FeedItem | null>(initial.selectedItem ?? null);
  const [detailError, setDetailError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailRetry, setDetailRetry] = useState(0);
  const detailRequestVersion = useRef(0);
  const [stateBusyId, setStateBusyId] = useState('');
  const itemMutations = useRef(new Map<string, Promise<void>>());
  const [view, setView] = useState(
    initialView === 'items' ? 'feed' : initialView === 'onboarding' ? 'subscriptions' : initialView,
  );
  const [selectedId, setSelectedId] = useState<string | null>(initialItemId ?? null);
  const selectedRef = useRef(selectedId);
  const mutationVersion = useRef(0);
  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);
  const [type, setType] = useState('all');
  const [search, setSearch] = useState('');
  const [unread, setUnread] = useState(false);
  const [source, setSource] = useState('');
  const [addOpen, setAddOpen] = useState(initialView === 'onboarding');
  const [addMethod, setAddMethod] = useState<'repo' | 'channel'>('repo');
  const [toast, setToast] = useState('');
  useEffect(() => {
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get('youtube');
    if (!['connected', 'cancelled', 'failed'].includes(outcome ?? '')) return;
    setAddMethod('channel');
    setAddOpen(true);
    setToast(
      outcome === 'connected'
        ? 'YouTube 已连接，可以读取我的关注'
        : outcome === 'cancelled'
          ? '已取消 YouTube 授权，可稍后重新连接'
          : 'YouTube 授权未完成，请重新连接',
    );
    url.searchParams.delete('youtube');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }, []);
  const [busy, setBusy] = useState('');
  const [pollError, setPollError] = useState('');
  const poller = useRef<ReturnType<typeof startPolling> | null>(null);
  const activeJobs = useRef(false);
  const hasActiveJobs = data.jobs.some((job) => ['pending', 'running'].includes(job.status));
  useEffect(() => {
    if (activeJobs.current !== hasActiveJobs) {
      activeJobs.current = hasActiveJobs;
      poller.current?.retry();
    }
  }, [hasActiveJobs]);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const noticeButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastSelectedRef = useRef(selectedId);
  const [discoveryRefresh, setDiscoveryRefresh] = useState(0);
  const initialPage = useRef<FeedPage>({
    total: initial.items.length,
    unread: initial.items.filter((item) => !item.read && !item.muted).length,
    saved: initial.items.filter((item) => item.saved && !item.muted).length,
    nextCursor: null,
    ...initial.feed,
    items: initial.items,
  }).current;
  const ingestFeedItems = useCallback((items: FeedPreview[]) => {
    for (const item of items) itemCache.current.set(item.id, item);
    for (const id of itemCache.current.keys()) {
      if (itemCache.current.size <= 600) break;
      if (id !== selectedRef.current && !itemMutations.current.has(id))
        itemCache.current.delete(id);
    }
    setData((current) => ({ ...current, items: items.slice(-300) }));
  }, []);
  const feed = useFeed(
    { view, type, search, unread, source },
    initialPage,
    isFeedView(view),
    ingestFeedItems,
  );
  const feedPage = feed.page;
  const feedLoading = feed.loading;
  const refreshFeedRef = useRef(feed.refresh);
  refreshFeedRef.current = feed.refresh;
  const routeTitleRef = useRef<HTMLElement | null>(null);
  const hasMountedRouteRef = useRef(false);
  const feedPanelRef = useRef<HTMLElement | null>(null);
  const feedContexts = useRef<Record<FeedView, FeedContext>>({
    feed: emptyFeedContext(),
    saved: emptyFeedContext(),
  });
  const checkUpdatesRef = useRef(feed.checkUpdates);
  checkUpdatesRef.current = feed.checkUpdates;
  const refreshInFlight = useRef<Promise<Bootstrap> | null>(null);
  const detailJobsKey = useRef('');
  const refresh = useCallback(async function refreshRequest(
    options: { background?: boolean; signal?: AbortSignal } = {},
  ): Promise<Bootstrap> {
    if (refreshInFlight.current) {
      if (options.background) return refreshInFlight.current;
      await refreshInFlight.current.catch(() => {});
      return refreshRequest(options);
    }
    const operation = (async () => {
      const next = await requestJson<Bootstrap>(
        options.background ? '/api/bootstrap?metadata=true' : '/api/bootstrap',
        'GET',
        undefined,
        options.signal,
      );
      setData((current) => ({ ...next, items: current.items, feed: current.feed }));
      if (
        !options.background &&
        (isFeedView(location.pathname.split('/')[1] || '') ||
          location.pathname.startsWith('/items/'))
      ) {
        if ((await refreshFeedRef.current()) === false)
          throw new Error('列表刷新失败，请使用列表中的重试按钮。');
      } else {
        await Promise.allSettled([...itemMutations.current.values()]);
        const version = mutationVersion.current;
        await checkUpdatesRef.current(
          options.signal ?? AbortSignal.timeout(15000),
          () => version === mutationVersion.current,
        );
      }
      const detailId = selectedRef.current;
      const jobsKey = JSON.stringify(next.jobs.filter((job) => job.targetId === detailId));
      if (detailId && (!options.background || jobsKey !== detailJobsKey.current)) {
        await Promise.allSettled([...itemMutations.current.values()]);
        if (selectedRef.current !== detailId) return next;
        const version = mutationVersion.current;
        const detailVersion = ++detailRequestVersion.current;
        try {
          const item = await requestJson<FeedItem>(
            `/api/items/${encodeURIComponent(detailId)}`,
            'GET',
            undefined,
            options.signal,
          );
          if (options.signal?.aborted) throw options.signal.reason;
          if (
            version === mutationVersion.current &&
            detailVersion === detailRequestVersion.current &&
            !options.signal?.aborted
          ) {
            detailJobsKey.current = jobsKey;
            itemCache.current.set(item.id, toFeedPreview(item));
            if (selectedRef.current === item.id) {
              setDetail(item);
              setDetailError('');
            }
          }
        } catch (error) {
          if (
            !options.signal?.aborted &&
            selectedRef.current === detailId &&
            detailVersion === detailRequestVersion.current
          )
            setDetailError(error instanceof Error ? error.message : '详情更新失败，请重试。');
          throw error;
        } finally {
          if (detailVersion === detailRequestVersion.current) setDetailLoading(false);
        }
      }
      return next;
    })();
    refreshInFlight.current = operation;
    try {
      return await operation;
    } finally {
      if (refreshInFlight.current === operation) refreshInFlight.current = null;
    }
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
    const previous = lastSelectedRef.current;
    lastSelectedRef.current = selectedId;
    requestAnimationFrame(() => {
      const card =
        !selectedId && previous && isFeedView(view)
          ? document.querySelector<HTMLButtonElement>(
              `[data-testid="item-${CSS.escape(previous)}"]`,
            )
          : null;
      (card ?? routeTitleRef.current)?.focus({ preventScroll: true });
    });
  }, [view, selectedId]);
  useEffect(() => {
    if (!noticeOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setNoticeOpen(false);
        noticeButtonRef.current?.focus();
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [noticeOpen]);
  useEffect(() => {
    const polling = startPolling({
      run: async (signal) => {
        await refresh({ background: true, signal });
      },
      active: () => activeJobs.current,
      onError: setPollError,
      document,
      window,
      online: () => navigator.onLine,
    });
    poller.current = polling;
    return () => polling.stop();
  }, [refresh]);
  useEffect(() => {
    if (!selectedId) return;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      setDetailError('');
      setDetailLoading(true);
      const version = mutationVersion.current;
      const detailVersion = ++detailRequestVersion.current;
      try {
        const item = await requestJson<FeedItem>(
          `/api/items/${encodeURIComponent(selectedId)}`,
          'GET',
          undefined,
          abort.signal,
        );
        if (abort.signal.aborted || detailVersion !== detailRequestVersion.current) return;
        const latest = itemCache.current.get(item.id);
        const merged =
          version !== mutationVersion.current && latest
            ? { ...item, read: latest.read, saved: latest.saved, muted: latest.muted }
            : item;
        itemCache.current.set(item.id, toFeedPreview(merged));
        setDetail(merged);
      } catch (error) {
        if (!abort.signal.aborted && detailVersion === detailRequestVersion.current)
          setDetailError(error instanceof Error ? error.message : '详情加载失败，请重试。');
      } finally {
        if (!abort.signal.aborted && detailVersion === detailRequestVersion.current)
          setDetailLoading(false);
      }
    }, 0);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [selectedId, detailRetry]);
  useEffect(() => {
    if (!selectedId) return;
    void patchItem(selectedId, { read: true });
    // One read mutation for each selected item; list membership may change after it succeeds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);
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
  const filtered = feedPage.items;
  const selected = detail?.id === selectedId ? detail : null;
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
    mutationVersion.current++;
    const operation = (itemMutations.current.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        feed.beginMutation();
        setStateBusyId(id);
        let success = false;
        const previous = itemCache.current.get(id);
        try {
          await requestJson(`/api/items/${id}/state`, 'PATCH', patch);
          mutationVersion.current++;
          if (previous) {
            itemCache.current.set(id, { ...previous, ...patch });
            feed.patch(previous, patch);
          }
          setDetail((current) => (current?.id === id ? { ...current, ...patch } : current));
          setData((current) => ({
            ...current,
            items: current.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
          }));
          success = true;
        } finally {
          feed.finishMutation(success);
          setStateBusyId((current) => (current === id ? '' : current));
        }
      });
    itemMutations.current.set(id, operation);
    try {
      await operation;
    } catch (error) {
      notify((error as Error).message);
    } finally {
      if (itemMutations.current.get(id) === operation) itemMutations.current.delete(id);
    }
  }
  function selectItem(id: string) {
    captureFeedContext();
    const preview = feedPage.items.find((item) => item.id === id);
    if (preview) itemCache.current.set(id, preview);
    setSelectedId(id);
    history.pushState({}, '', `/items/${id}`);
  }
  async function execute(key: string, action: () => Promise<unknown>, message?: string) {
    setBusy(key);
    let submitted = false;
    try {
      await action();
      submitted = true;
      await refresh();
      if (message) notify(message);
    } catch (error) {
      notify(`${submitted ? '操作已提交，但刷新未完成。' : ''}${(error as Error).message}`);
    } finally {
      setBusy('');
    }
  }
  async function markAll() {
    await execute(
      'read',
      async () => {
        await Promise.allSettled([...itemMutations.current.values()]);
        await requestJson(
          '/api/feed/read',
          'POST',
          Object.fromEntries(feedParams({ view, type, search, unread, source })),
        );
        feed.invalidate();
        setData((current) => ({
          ...current,
          items: current.items.map((item) =>
            filtered.some((row) => row.id === item.id) ? { ...item, read: true } : item,
          ),
        }));
      },
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
        data={{ ...data, feed: feedPage }}
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
            <strong ref={routeTitleRef} tabIndex={-1} aria-live="polite" aria-atomic="true">
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
              ref={noticeButtonRef}
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
        {pollError && (
          <div className="connection-banner" role="status">
            <span>后台刷新暂时失败，已有内容仍可阅读。{pollError}</span>
            <Button size="small" onClick={() => poller.current?.retry()}>
              重试连接
            </Button>
          </div>
        )}
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
              markAll={() => void markAll()}
              loading={feedLoading || busy === 'read'}
              total={feedPage.total}
              hasMore={!!feedPage.nextCursor}
              onLoadMore={feed.loadMore}
              onAdd={() => setAddOpen(true)}
              onBrowse={() => navigate('feed')}
              updatesAvailable={feed.updatesAvailable}
              onRefresh={() => {
                void feed.refresh();
                if (feedPanelRef.current) feedPanelRef.current.scrollTop = 0;
              }}
              error={feed.error}
              retry={feed.refresh}
              canMarkRead={(feedPage.matchingUnread ?? feedPage.unread) > 0}
              hasUnderlyingItems={
                (view === 'saved' ? feedPage.saved : (feedPage.all ?? initial.items.length)) > 0
              }
              sourceName={data.subscriptions.find((x) => x.id === source)?.name}
              panelRef={feedPanelRef}
              onScroll={(event) => {
                if (isFeedView(view))
                  feedContexts.current[view].scrollTop = event.currentTarget.scrollTop;
              }}
              clearFilters={() => {
                setSource('');
                setSearch('');
                setType('all');
                setUnread(false);
              }}
            />
            <ItemDetail
              key={selectedId ?? 'empty'}
              aiEnabled={data.services.ai}
              item={selected}
              loading={!!selectedId && (!selected || detailLoading) && !detailError}
              stateBusy={stateBusyId === selectedId}
              error={selectedId ? detailError : ''}
              retry={() => setDetailRetry((value) => value + 1)}
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
                summary: selectedJobs.find(
                  (job) => job.kind === 'summary' && job.status === 'failed',
                )?.error,
                translation: selectedJobs.find(
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
            {data.mode === 'demo'
              ? '24 条固定示例 · 可添加 GitHub / YouTube 订阅'
              : 'GitHub / YouTube 公开内容'}
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
        key={addMethod}
        initialMethod={addMethod}
        platformStatus={data.services.platforms}
        youtubeAuth={data.services.youtubeAuth}
        channelSubscriptionCount={
          data.subscriptions.filter(
            (subscription) =>
              sourcePlatform(subscription) === 'youtube' && subscription.kind === 'channel',
          ).length
        }
        onRefresh={async () => {
          await refresh({ background: true });
        }}
        open={addOpen}
        onOpenChange={setAddOpen}
        authorSubscriptionCount={
          data.subscriptions.filter((subscription) => subscription.kind === 'author').length
        }
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
