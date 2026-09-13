'use client';
import { useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import type { RepositorySearchResult } from '@/shared/types';
import { Button } from './ui/button';
import { requestJson } from './reader-app';

export function RepositorySearch({
  onAdded,
  onBusyChange,
}: {
  onAdded: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('relevance');
  const [result, setResult] = useState<RepositorySearchResult | null>(null);
  const [resultSort, setResultSort] = useState('relevance');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const resultsRef = useRef<HTMLDivElement>(null);
  function working(value: string) {
    setBusy(value);
    onBusyChange(!!value);
  }
  async function search(page = 1, keyword = query, order = sort) {
    working('search');
    setError('');
    try {
      const data = await requestJson<RepositorySearchResult>(
        '/api/github/repositories/search',
        'POST',
        { query: keyword, page, sort: order },
      );
      setResult(data);
      setResultSort(order);
      resultsRef.current?.scrollTo({ top: 0 });
    } catch (error) {
      setError(error instanceof Error ? error.message : '搜索失败，请重试。');
    } finally {
      working('');
    }
  }
  async function subscribe(repo: RepositorySearchResult['repositories'][number]) {
    working(repo.id);
    setError('');
    try {
      await requestJson('/api/subscriptions', 'POST', { kind: 'repo', input: repo.name });
      setResult(
        (current) =>
          current && {
            ...current,
            repositories: current.repositories.map((item) =>
              item.id === repo.id ? { ...item, subscribed: true } : item,
            ),
          },
      );
      try {
        await onAdded();
      } catch {
        setError('订阅已添加，页面刷新失败，请稍后刷新。');
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : '订阅失败，请重试。');
    } finally {
      working('');
    }
  }
  return (
    <div className="repository-search">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <label className="field-label" htmlFor="repository-query">
          搜索 GitHub 公开项目
        </label>
        <input
          id="repository-query"
          className="text-input"
          placeholder="项目名称或关键词，例如 AI agent"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          required
          maxLength={200}
          disabled={!!busy}
        />
        <div className="repository-search-controls">
          <select
            aria-label="项目搜索排序"
            className="select-input"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            disabled={!!busy}
          >
            <option value="relevance">最相关</option>
            <option value="stars">Star 最多</option>
            <option value="updated">最近更新</option>
          </select>
          <Button type="submit" variant="primary" disabled={!!busy || !query.trim()}>
            {busy === 'search' ? <Loader2 size={15} className="spin" /> : <Search size={15} />}搜索
          </Button>
        </div>
      </form>
      <p className="helper">
        订阅仅在知更中跟踪正式版本，不会改变 GitHub Star。搜索使用 GitHub 原始项目介绍。
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {result && (
        <>
          <p className="repository-search-summary" role="status">
            “{result.query}” · {result.totalCount.toLocaleString()} 个匹配 · 第 {result.page} 页
          </p>
          {result.incomplete && (
            <p className="warning-text">GitHub 本次只返回部分搜索结果，可稍后重试。</p>
          )}
          {result.totalCount > 1000 && (
            <p className="helper">最多可浏览前 1000 个匹配，请增加关键词缩小范围。</p>
          )}
          {!result.repositories.length && (
            <p className="helper">当前没有可展示的公开项目，试试其他关键词。</p>
          )}
          <div
            ref={resultsRef}
            className="repository-search-results"
            aria-label="项目搜索结果"
            aria-busy={!!busy}
          >
            {result.repositories.map((repo) => (
              <article key={repo.id}>
                <a href={repo.url} target="_blank" rel="noopener noreferrer">
                  {repo.name}
                </a>
                <p>{repo.description || '该项目暂未填写简介。'}</p>
                <div className="repository-result-footer">
                  <span>
                    {repo.language || '未标注语言'} · {repo.stars.toLocaleString()} Stars
                    {repo.archived ? ' · 已归档' : ''}
                  </span>
                  <Button
                    size="small"
                    disabled={!!busy || repo.subscribed}
                    onClick={() => subscribe(repo)}
                  >
                    {busy === repo.id ? <Loader2 size={14} className="spin" /> : null}
                    {repo.subscribed ? '已在知更订阅' : '在知更中订阅'}
                  </Button>
                </div>
              </article>
            ))}
          </div>
          <div className="repository-search-controls">
            <Button
              size="small"
              disabled={!!busy || result.page === 1}
              onClick={() => search(result.page - 1, result.query, resultSort)}
            >
              上一页
            </Button>
            <Button
              size="small"
              disabled={!!busy || !result.nextPage}
              onClick={() => result.nextPage && search(result.nextPage, result.query, resultSort)}
            >
              下一页
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
