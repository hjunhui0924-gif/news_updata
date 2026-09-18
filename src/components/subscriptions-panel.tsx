'use client';
import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowUpRight,
  Check,
  CodeXml as Github,
  Loader2,
  Plus,
  RefreshCw,
  Star,
  Users,
  X,
} from 'lucide-react';
import type { Job, Subscription, StarSyncStatus } from '@/shared/types';
import { getSubscriptionSyncStatus } from '@/shared/sync-status';
import { Button } from './ui/button';
import { requestJson } from './reader-app';
import { StarredImport } from './starred-import';
import { FollowingImport } from './following-import';
import { StarSyncPanel } from './star-sync-panel';
import { RepositorySearch } from './repository-search';

export function SubscriptionsPanel({
  subscriptions,
  jobs,
  onAdd,
  onAction,
  busy,
  starSync,
  showStarSync,
  workerOnline,
  onStarAction,
  onViewSource,
}: {
  subscriptions: Subscription[];
  jobs: Job[];
  onAdd: () => void;
  onAction: (id: string, action: string) => Promise<void>;
  busy: string;
  starSync: StarSyncStatus | null;
  showStarSync: boolean;
  workerOnline: boolean;
  onStarAction: (action: 'check' | 'enable' | 'disable') => Promise<void>;
  onViewSource: (id: string) => void;
}) {
  const [kind, setKind] = useState('all');
  return (
    <section className="management-page">
      <div className="management-heading">
        <div>
          <span className="eyebrow">CURATE YOUR SOURCES</span>
          <h1>关注你真正关心的</h1>
          <p>订阅项目看项目版本，关注博主看他新建的项目和本人发布的版本。</p>
        </div>
        <Button variant="primary" onClick={onAdd}>
          <Plus size={16} />
          添加订阅
        </Button>
      </div>
      <div className="subscription-summary">
        <span>
          <strong>{subscriptions.filter((x) => x.enabled).length}</strong> 正在关注
        </span>
        <span>
          <strong>{subscriptions.filter((x) => x.priority).length}</strong> 重点项目
        </span>
        <p>
          <Github size={15} />
          GitHub 公开内容
        </p>
      </div>
      {showStarSync && (
        <StarSyncPanel
          status={starSync}
          busy={busy === 'stars'}
          workerOnline={workerOnline}
          pending={jobs.some(
            (job) => job.kind === 'stars' && ['pending', 'running'].includes(job.status),
          )}
          onAction={onStarAction}
        />
      )}
      {!workerOnline && subscriptions.some((subscription) => subscription.enabled) && (
        <div className="sync-service-banner" role="status">
          <RefreshCw size={15} />
          <span>后台同步服务未连接，已有内容仍可阅读；服务恢复后会继续检查。</span>
        </div>
      )}
      <div className="segmented management-tabs">
        {[
          ['all', '全部来源'],
          ['repo', '项目仓库'],
          ['author', '开发者'],
        ].map(([value, label]) => (
          <button
            key={value}
            className={kind === value ? 'selected' : ''}
            onClick={() => setKind(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="subscription-list">
        {subscriptions
          .filter((x) => kind === 'all' || x.kind === kind)
          .map((sub) => {
            const syncStatus = getSubscriptionSyncStatus(sub, jobs, workerOnline);
            const syncing = ['waiting', 'syncing'].includes(syncStatus.state);
            const syncBlocked = [
              'waiting',
              'syncing',
              'rate_limited',
              'auth_required',
              'worker_offline',
            ].includes(syncStatus.state);
            return (
              <article className={`subscription-card ${sub.enabled ? '' : 'paused'}`} key={sub.id}>
                <span className={`repo-avatar large ${sub.kind === 'author' ? 'blue' : 'slate'}`}>
                  {sub.kind === 'author' ? <Users size={21} /> : <Github size={22} />}
                </span>
                <div className="subscription-info">
                  <h2>
                    <a href={sub.url} target="_blank" rel="noreferrer">
                      {sub.name}
                      <ArrowUpRight size={14} />
                    </a>
                    {sub.demo && <span className="demo-mini">示例</span>}
                  </h2>
                  <p>{sub.description || '公开 GitHub 来源'}</p>
                  <p className="subscription-scope">
                    {sub.kind === 'author'
                      ? '跟踪：新建公开项目 · 本人发布的正式版本'
                      : '跟踪：正式版本 · 已收录版本的说明变化'}
                  </p>
                  <div className="subscription-status">
                    <span className={`sync-state sync-state-${syncStatus.state}`}>
                      {syncStatus.label}
                    </span>
                    {syncStatus.state === 'completed' && sub.lastSyncAt && (
                      <span>上次检查 {new Date(sub.lastSyncAt).toLocaleString('zh-CN')}</span>
                    )}
                    {syncStatus.state === 'partial' && <span>还有内容待补查</span>}
                    {syncStatus.state === 'rate_limited' && syncStatus.retryAt && (
                      <span>可在 {new Date(syncStatus.retryAt).toLocaleString('zh-CN')} 后重试</span>
                    )}
                    {syncStatus.state === 'waiting' && sub.lastSyncAt && (
                      <span>等待下一次检查 · 上次 {new Date(sub.lastSyncAt).toLocaleString('zh-CN')}</span>
                    )}
                  </div>
                  {sub.error && <p className="error-text">{sub.error}</p>}
                  {sub.kind === 'author' && sub.authorEventWindowCapped && (
                    <p className="warning-text">
                      公开活动已达到 300 条窗口上限，更早的发布动态可能无法补查。
                    </p>
                  )}
                </div>
                <div className="subscription-actions">
                  <Button size="small" onClick={() => onViewSource(sub.id)}>
                    查看更新
                  </Button>
                  <button
                    className={`icon-button ${sub.priority ? 'is-saved' : ''}`}
                    disabled={busy === sub.id}
                    aria-label={`${sub.name}${sub.priority ? '取消重点' : '设为重点'}`}
                    onClick={() => onAction(sub.id, 'priority')}
                  >
                    <Star size={17} fill={sub.priority ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={syncBlocked || busy === sub.id || !sub.enabled}
                    aria-label={`同步 ${sub.name}`}
                    onClick={() => onAction(sub.id, 'sync')}
                  >
                    <RefreshCw size={16} className={syncing ? 'spin' : ''} />
                  </button>
                  <Button
                    size="small"
                    onClick={() => onAction(sub.id, sub.enabled ? 'pause' : 'resume')}
                    disabled={busy === sub.id}
                  >
                    {sub.enabled ? '暂停' : '恢复'}
                  </Button>
                  <button
                    className="text-action"
                    disabled={busy === sub.id}
                    onClick={() => {
                      if (window.confirm(`取消订阅 ${sub.name}？已获取的内容和收藏会保留。`))
                        void onAction(sub.id, 'delete');
                    }}
                  >
                    取消订阅
                  </button>
                </div>
              </article>
            );
          })}
      </div>
      {!subscriptions.filter((x) => kind === 'all' || x.kind === kind).length && (
        <div className="empty-state">
          <Github size={30} />
          <h3>从一个喜欢的项目开始</h3>
          <p>添加仓库、导入 Star 项目，或关注开发者。</p>
          <Button onClick={onAdd}>添加第一个订阅</Button>
        </div>
      )}
      <div className="sub-explainer">
        <Users size={20} />
        <div>
          <strong>项目看版本，博主看本人发布</strong>
          <p>
            博主关注包含他新建的公开项目，以及他在个人、组织或其他仓库发布的正式版本。同一版本命中多个关注来源时合并展示。
          </p>
          <p>
            博主版本动态最多覆盖最近 30 天、300 条公开活动，GitHub 可能延迟 30 秒至 6
            小时；重要项目可单独订阅以持续检查版本。
          </p>
        </div>
      </div>
    </section>
  );
}

export function AddSubscription({
  open,
  onOpenChange,
  onAdded,
  authorSubscriptionCount,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdded: () => Promise<void>;
  authorSubscriptionCount: number;
}) {
  const [kind, setKind] = useState<'repo' | 'author' | 'following' | 'starred' | 'search'>('repo');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await requestJson('/api/subscriptions', 'POST', { kind, input: value });
      await onAdded();
      onOpenChange(false);
      setValue('');
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <Dialog.Close asChild>
            <button className="dialog-close icon-button" aria-label="关闭添加订阅" disabled={busy}>
              <X size={19} />
            </button>
          </Dialog.Close>
          <span className="dialog-icon">
            <Plus size={22} />
          </span>
          <Dialog.Title>添加一份值得关注的更新</Dialog.Title>
          <Dialog.Description>
            从 GitHub 公开仓库或开发者开始，建立自己的信息源。
          </Dialog.Description>
          <div className="segmented dialog-tabs">
            {[
              ['repo', '项目仓库'],
              ['search', '搜索项目'],
              ['starred', '导入 Star'],
              ['author', '开发者'],
              ['following', '导入关注'],
            ].map(([key, label]) => (
              <button
                key={key}
                disabled={busy}
                className={kind === key ? 'selected' : ''}
                onClick={() => {
                  setKind(key as typeof kind);
                  setError('');
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {kind === 'search' ? (
            <RepositorySearch onAdded={onAdded} onBusyChange={setBusy} />
          ) : kind === 'starred' ? (
            <StarredImport
              onAdded={onAdded}
              onClose={() => onOpenChange(false)}
              onBusyChange={setBusy}
            />
          ) : kind === 'following' ? (
            <FollowingImport
              onAdded={onAdded}
              onClose={() => onOpenChange(false)}
              onBusyChange={setBusy}
              authorSubscriptionCount={authorSubscriptionCount}
            />
          ) : (
            <form onSubmit={submit}>
              <label className="field-label" htmlFor="source-input">
                {kind === 'repo' ? '仓库地址或 owner/repo' : 'GitHub 用户名'}
              </label>
              <input
                id="source-input"
                className="text-input"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                }}
                placeholder={kind === 'repo' ? '例如 vercel/next.js' : '例如 torvalds'}
                required
                maxLength={200}
              />
              <p className="helper">
                {kind === 'repo'
                  ? '跟踪正式版本发布，首次导入的历史版本不会作为新提醒。'
                  : kind === 'author'
                    ? '跟踪新建公开项目和本人发布的正式版本；版本动态受 GitHub 近期公开活动窗口限制。'
                    : ''}
              </p>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <div className="dialog-footer">
                <span>
                  <Github size={14} />
                  仅访问公开信息
                </span>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={busy}
                >
                  {busy ? <Loader2 size={15} className="spin" /> : <Check size={15} />}{' '}
                  添加订阅
                </Button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
