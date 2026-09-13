'use client';
import { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Compass,
  Languages,
  Loader2,
  Plus,
  RefreshCw,
  Star,
  TrendingUp,
} from 'lucide-react';
import {
  trendingLanguages,
  type TrendingSnapshot,
  type TrendingRepository,
} from '@/shared/trending';
import type { Subscription } from '@/shared/types';
import { Button } from './ui/button';
import { Markdown } from './markdown';

async function request<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    signal,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '暂时无法完成操作，请重试。');
  return data;
}

export function TrendingPanel({
  subscriptions,
  aiEnabled,
  timezone,
  onSubscribed,
  refreshVersion,
}: {
  subscriptions: Subscription[];
  aiEnabled: boolean;
  timezone: string;
  onSubscribed: () => Promise<unknown>;
  refreshVersion: number;
}) {
  const [language, setLanguage] = useState('');
  const [snapshot, setSnapshot] = useState<TrendingSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let controller: AbortController;
    async function load() {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      try {
        const result = await request<TrendingSnapshot>(
          `/api/trending?language=${encodeURIComponent(language)}`,
          undefined,
          current.signal,
        );
        if (!current.signal.aborted) {
          setSnapshot(result);
          setError('');
        }
      } catch (error) {
        if (!current.signal.aborted) setError((error as Error).message);
      } finally {
        if (!current.signal.aborted) setLoading(false);
      }
    }
    void load();
    const timer = setInterval(
      () => {
        setLoading(true);
        void load();
      },
      5 * 60 * 1000,
    );
    return () => {
      clearInterval(timer);
      controller?.abort();
    };
  }, [language, refreshVersion, retry]);
  const visible = snapshot?.language === language ? snapshot : null;
  return (
    <section className="discovery-panel" aria-label="Trending 项目发现">
      <div className="discovery-heading">
        <div>
          <span className="eyebrow">EXPLORE SOMETHING NEW</span>
          <h1>
            今日精选<span>发现下一份关注</span>
          </h1>
          <p>从 GitHub Trending 发现热门开源项目，遇到感兴趣的，再订阅它的后续更新。</p>
        </div>
        <span className="discovery-mark">
          <Compass size={36} strokeWidth={1.3} />
        </span>
      </div>
      <div className="discovery-controls">
        <label>
          编程语言
          <select
            aria-label="编程语言"
            value={language}
            onChange={(e) => {
              setLoading(true);
              setError('');
              setLanguage(e.target.value);
            }}
          >
            {trendingLanguages.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <span className="neutral-tag">
          <TrendingUp size={14} /> 今日趋势
        </span>
        <Button
          size="small"
          onClick={() => {
            setLoading(true);
            setError('');
            setRetry((x) => x + 1);
          }}
          disabled={loading}
        >
          {loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}刷新榜单
        </Button>
        <a
          href={
            visible?.sourceUrl ??
            `https://github.com/trending${language ? '/' + encodeURIComponent(language) : ''}?since=daily`
          }
          target="_blank"
          rel="noreferrer"
        >
          查看 GitHub 榜单
          <ArrowUpRight size={14} />
        </a>
      </div>
      <p className="discovery-context">
        按 GitHub 榜单顺序展示 · 每 24 小时更新快照 · 热度供发现参考
      </p>
      {visible?.fetchedAt && (
        <p className="helper">
          {visible.stale ? '旧快照' : '抓取时间'}：
          {new Date(visible.fetchedAt).toLocaleString('zh-CN', { timeZone: timezone })} · {timezone}
        </p>
      )}
      {(error || visible?.error) && (
        <div className="discovery-warning" role="alert">
          {error || visible?.error}
        </div>
      )}
      {loading && (
        <p className="discovery-loading" role="status">
          <Loader2 className="spin" size={18} />
          正在读取榜单…
        </p>
      )}
      {visible && !loading && !visible.repositories.length && !visible.error && (
        <div className="empty-state">
          <Compass size={28} />
          <h3>这个榜单暂时没有项目</h3>
          <p>试试其他语言。</p>
        </div>
      )}
      <div className="discovery-list" aria-busy={loading}>
        {visible?.repositories.map((repo) => (
          <TrendingCard
            key={`${language}:${repo.name}:${repo.description}`}
            repo={repo}
            language={language}
            subscription={subscriptions.find(
              (s) => s.kind === 'repo' && s.name.toLowerCase() === repo.name.toLowerCase(),
            )}
            aiEnabled={aiEnabled}
            onSubscribed={onSubscribed}
          />
        ))}
      </div>
    </section>
  );
}

function TrendingCard({
  repo,
  language,
  subscription,
  aiEnabled,
  onSubscribed,
}: {
  repo: TrendingRepository;
  language: string;
  subscription?: Subscription;
  aiEnabled: boolean;
  onSubscribed: () => Promise<unknown>;
}) {
  const [translation, setTranslation] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const chinese = translation || repo.chineseDescription;
  async function act(kind: 'subscribe' | 'translate') {
    setBusy(kind);
    setError('');
    try {
      if (kind === 'subscribe') {
        await request('/api/subscriptions', { kind: 'repo', input: repo.name });
        await onSubscribed();
      } else {
        const result = await request<{ description: string; translation: string }>(
          '/api/trending/translation',
          { name: repo.name, language },
        );
        if (result.description !== repo.description)
          throw new Error('项目简介已变化，请刷新榜单后重试。');
        setTranslation(result.translation);
      }
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy('');
    }
  }
  return (
    <article className="discovery-card" aria-label={repo.name}>
      <span className="discovery-rank">{String(repo.rank).padStart(2, '0')}</span>
      <div className="discovery-card-body">
        <h2>
          <a href={repo.url} target="_blank" rel="noreferrer">
            {repo.name}
            <ArrowUpRight size={16} />
          </a>
        </h2>
        <p className="discovery-description">
          {repo.description || '该项目暂未提供简介，可前往 GitHub 阅读文档。'}
        </p>
        {chinese && (
          <div className="discovery-chinese">
            <span className="bilingual-label">
              <Languages size={13} /> 中文简介 · AI 翻译
            </span>
            <Markdown text={chinese} />
          </div>
        )}
        <div className="discovery-stats">
          {repo.language && <span>{repo.language}</span>}
          {repo.stars !== null && (
            <span>
              <Star size={13} />
              {repo.stars.toLocaleString('zh-CN')} Stars
            </span>
          )}
          {repo.starsToday !== null && (
            <span className="discovery-growth">
              <TrendingUp size={13} />
              今日 +{repo.starsToday.toLocaleString('zh-CN')}
            </span>
          )}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="discovery-card-actions">
        <Button
          size="small"
          disabled={!!busy || !!subscription}
          onClick={() => void act('subscribe')}
        >
          {busy === 'subscribe' ? (
            <Loader2 size={14} className="spin" />
          ) : subscription ? (
            <Check size={14} />
          ) : (
            <Plus size={14} />
          )}
          {subscription ? (subscription.enabled ? '已订阅' : '已订阅 · 暂停') : '订阅更新'}
        </Button>
        {!chinese && repo.description && (
          <Button
            size="small"
            variant="ghost"
            disabled={!!busy || !aiEnabled}
            onClick={() => void act('translate')}
          >
            {busy === 'translate' ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <Languages size={14} />
            )}
            {aiEnabled ? '翻译简介' : 'AI 未启用'}
          </Button>
        )}
      </div>
    </article>
  );
}
