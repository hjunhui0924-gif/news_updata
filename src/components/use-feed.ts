'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FeedPreview, FeedPage } from '@/shared/types';
import { filterItems } from '@/shared/feed';
import { requestJson } from './request-json';

export type FeedFilters = {
  view: string;
  type: string;
  search: string;
  unread: boolean;
  source: string;
};
type Entry = { page: FeedPage; pages: number; stale?: boolean };
export function feedParams(filters: FeedFilters, cursor?: string | null) {
  const params = new URLSearchParams({ ...filters, unread: String(filters.unread) });
  if (cursor) params.set('cursor', cursor);
  return params;
}
export function patchFeedPage(
  page: FeedPage,
  filters: FeedFilters,
  before: FeedPreview,
  patch: Partial<FeedPreview>,
): FeedPage {
  before = page.items.find((item) => item.id === before.id) ?? before;
  const after = { ...before, ...patch };
  const matches = (item: FeedPreview) => filterItems([item], filters).length;
  const visible = (item: FeedPreview) => Number(!item.muted);
  let updatedItems = filterItems(
    page.items.map((item) => (item.id === before.id ? after : item)),
    filters,
  );
  if (!matches(before) && matches(after) && !updatedItems.some((item) => item.id === after.id))
    updatedItems = [...updatedItems, after].sort(
      (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || (a.id < b.id ? 1 : -1),
    );
  return {
    ...page,
    items: updatedItems,
    total: Math.max(0, page.total + matches(after) - matches(before)),
    unread: Math.max(
      0,
      page.unread + visible(after) * Number(!after.read) - visible(before) * Number(!before.read),
    ),
    saved: Math.max(
      0,
      page.saved + visible(after) * Number(after.saved) - visible(before) * Number(before.saved),
    ),
    all:
      page.all === undefined ? undefined : Math.max(0, page.all + visible(after) - visible(before)),
    matchingUnread:
      page.matchingUnread === undefined
        ? undefined
        : Math.max(
            0,
            page.matchingUnread +
              matches(after) * Number(!after.read) -
              matches(before) * Number(!before.read),
          ),
  };
}
export function useFeed(
  filters: FeedFilters,
  initial: FeedPage,
  enabled: boolean,
  onItems: (items: FeedPreview[]) => void,
) {
  const key = JSON.stringify(filters);
  const [entries, setEntries] = useState(
    () =>
      new Map<string, Entry>([
        [
          JSON.stringify({ view: 'feed', type: 'all', search: '', unread: false, source: '' }),
          { page: initial, pages: 1 },
        ],
      ]),
  );
  const cache = useRef(new Map(entries));
  const [counts, setCounts] = useState({
    unread: initial.unread,
    saved: initial.saved,
    all: initial.all,
  });
  const mounted = useRef(false);
  const [loading, setLoading] = useState(false);
  const [waitingForMutation, setWaitingForMutation] = useState(false);
  const [failure, setFailure] = useState({ key: '', message: '' });
  const error = failure.key === key ? failure.message : '';
  const [updatesAvailable, setUpdatesAvailable] = useState(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const mutations = useRef(0);
  const mutationEpoch = useRef(0);
  const reloadNeeded = useRef(false);
  const requestedAppend = useRef<string | null>(null);
  const filtersRef = useRef(filters);
  const enabledRef = useRef(enabled);
  const onItemsRef = useRef(onItems);
  useEffect(() => {
    onItemsRef.current = onItems;
  }, [onItems]);

  const fetchPages = useCallback(async (append = false) => {
    if (!enabledRef.current) return;
    const currentFilters = filtersRef.current;
    const queryKey = JSON.stringify(currentFilters);
    if (append && pending.current) return;
    requestedAppend.current = append ? queryKey : null;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const version = ++generation.current;
    const epoch = mutationEpoch.current;
    pending.current = true;
    setLoading(true);
    setFailure({ key: queryKey, message: '' });
    const previous = cache.current.get(queryKey);
    try {
      let cursor = append ? previous?.page.nextCursor : null;
      if (append && !cursor) return;
      let collected = append ? [...previous!.page.items] : [];
      let result: FeedPage | undefined;
      let fetched = 0;
      const pages = append ? 1 : (previous?.pages ?? 1);
      do {
        result = await requestJson<FeedPage>(
          `/api/feed?${feedParams(currentFilters, cursor)}`,
          'GET',
          undefined,
          abort.signal,
        );
        const ids = new Set(collected.map((item) => item.id));
        collected = [...collected, ...result.items.filter((item) => !ids.has(item.id))];
        cursor = result.nextCursor;
        fetched++;
      } while (cursor && fetched < pages);
      if (version !== generation.current || !result) return;
      if (epoch !== mutationEpoch.current || mutations.current) {
        reloadNeeded.current = true;
        setWaitingForMutation(true);
        return;
      }
      requestedAppend.current = null;
      const page = { ...result, items: collected };
      cache.current.set(queryKey, { page, pages: append ? (previous?.pages ?? 0) + 1 : fetched });
      if (cache.current.size > 8) cache.current.delete(cache.current.keys().next().value!);
      setEntries(new Map(cache.current));
      if (!append) setUpdatesAvailable(false);
      setCounts({ unread: page.unread, saved: page.saved, all: page.all });
      onItemsRef.current(page.items);
      return true;
    } catch (failure) {
      if (!abort.signal.aborted && version === generation.current)
        setFailure({
          key: queryKey,
          message: failure instanceof Error ? failure.message : '列表加载失败，请重试。',
        });
      return false;
    } finally {
      if (version === generation.current) {
        pending.current = false;
        setLoading(false);
      }
    }
  }, []);
  useEffect(() => {
    filtersRef.current = JSON.parse(key);
    enabledRef.current = enabled;
    requestedAppend.current = null;
    controller.current?.abort();
    generation.current++;
    pending.current = false;
    const timer = setTimeout(
      () => {
        const firstLoad = !mounted.current;
        mounted.current = true;
        setFailure({ key, message: '' });
        setUpdatesAvailable(false);
        if (enabled && (firstLoad || !cache.current.has(key) || cache.current.get(key)?.stale))
          void fetchPages();
        else setLoading(false);
      },
      filtersRef.current.search ? 250 : 0,
    );
    const versionRef = generation;
    return () => {
      clearTimeout(timer);
      controller.current?.abort();
      versionRef.current++;
      pending.current = false;
    };
  }, [key, enabled, fetchPages]);
  const patch = useCallback((before: FeedPreview, changes: Partial<FeedPreview>) => {
    const reload = pending.current;
    controller.current?.abort();
    generation.current++;
    pending.current = false;
    setLoading(false);
    for (const [queryKey, entry] of cache.current) {
      const query = JSON.parse(queryKey) as FeedFilters;
      if (
        queryKey !== JSON.stringify(filtersRef.current) &&
        !filterItems([before], query).length &&
        filterItems([{ ...before, ...changes }], query).length
      )
        cache.current.delete(queryKey);
      else
        cache.current.set(queryKey, {
          ...entry,
          page: patchFeedPage(entry.page, query, before, changes),
          stale: entry.stale || !entry.page.items.some((item) => item.id === before.id),
        });
    }
    setEntries(new Map(cache.current));
    setCounts((current) => {
      const updated = patchFeedPage(
        { ...current, items: [], total: 0, nextCursor: null },
        filtersRef.current,
        before,
        changes,
      );
      return { unread: updated.unread, saved: updated.saved, all: updated.all };
    });
    if (reload) reloadNeeded.current = true;
  }, []);
  const page = useMemo<FeedPage>(
    () => ({ ...(entries.get(key)?.page ?? { items: [], total: 0, nextCursor: null }), ...counts }),
    [entries, key, counts],
  );
  const checkUpdates = useCallback(
    async (signal: AbortSignal, accept: () => boolean = () => true) => {
      if (pending.current || mutations.current) return;
      const filters = filtersRef.current;
      const active = ['feed', 'saved'].includes(filters.view);
      const params = feedParams(
        active ? filters : { view: 'feed', type: 'all', search: '', unread: false, source: '' },
      );
      params.set('status', 'true');
      const version = generation.current;
      const status = await requestJson<
        Omit<FeedPage, 'items' | 'nextCursor'> & { headId: string | null }
      >(`/api/feed?${params}`, 'GET', undefined, signal);
      if (signal.aborted || version !== generation.current || mutations.current || !accept())
        return;
      setCounts({ unread: status.unread, saved: status.saved, all: status.all });
      const entry = cache.current.get(JSON.stringify(filters));
      if (
        active &&
        entry &&
        (entry.page.items[0]?.id !== (status.headId ?? undefined) ||
          entry.page.total !== status.total ||
          entry.page.unread !== status.unread ||
          entry.page.saved !== status.saved)
      )
        setUpdatesAvailable(true);
    },
    [],
  );
  return {
    page,
    loading: loading || waitingForMutation || (enabled && !entries.has(key) && !error),
    error,
    updatesAvailable,
    checkUpdates,
    beginMutation: () => {
      mutations.current++;
      mutationEpoch.current++;
      if (pending.current) reloadNeeded.current = true;
    },
    finishMutation: (success: boolean) => {
      mutations.current = Math.max(0, mutations.current - 1);
      mutationEpoch.current++;
      if (!success) reloadNeeded.current = true;
      if (!mutations.current && reloadNeeded.current) {
        reloadNeeded.current = false;
        setWaitingForMutation(false);
        void fetchPages(requestedAppend.current === JSON.stringify(filtersRef.current));
      }
    },
    refresh: () => fetchPages(),
    loadMore: () => fetchPages(true),
    patch,
    invalidate: () => {
      const active = JSON.stringify(filtersRef.current);
      for (const queryKey of cache.current.keys())
        if (queryKey !== active) cache.current.delete(queryKey);
    },
  };
}
