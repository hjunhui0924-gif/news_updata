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
import type { Job, Subscription } from '@/shared/types';
import { Button } from './ui/button';
import { requestJson } from './reader-app';

export function SubscriptionsPanel({
  subscriptions,
  jobs,
  onAdd,
  onAction,
  busy,
}: {
  subscriptions: Subscription[];
  jobs: Job[];
  onAdd: () => void;
  onAction: (id: string, action: string) => Promise<void>;
  busy: string;
}) {
  const [kind, setKind] = useState('all');
  return (
    <section className="management-page">
      <div className="management-heading">
        <div>
          <span className="eyebrow">CURATE YOUR SOURCES</span>
          <h1>关注你真正关心的</h1>
          <p>开发者带来新发现，仓库带来持续的版本更新。</p>
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
            const syncing = jobs.some(
              (x) => x.targetId === sub.id && ['pending', 'running'].includes(x.status),
            );
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
                  <div className="subscription-status">
                    <span>{sub.enabled ? '正在关注' : '已暂停'}</span>
                    <span>
                      {syncing
                        ? '正在同步…'
                        : sub.lastSyncAt
                          ? `上次检查 ${new Date(sub.lastSyncAt).toLocaleString('zh-CN')}`
                          : '等待首次同步'}
                    </span>
                    {sub.coverage === 'partial' && (
                      <span className="warning-text">部分内容待补查</span>
                    )}
                  </div>
                  {sub.error && <p className="error-text">{sub.error}</p>}
                </div>
                <div className="subscription-actions">
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
                    disabled={syncing || busy === sub.id || !sub.enabled}
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
          <p>添加仓库，或导入你关注的开发者。</p>
          <Button onClick={onAdd}>添加第一个订阅</Button>
        </div>
      )}
      <div className="sub-explainer">
        <Users size={20} />
        <div>
          <strong>关注开发者 ≠ 订阅所有仓库</strong>
          <p>关注开发者会发现其新建公开仓库。想持续跟踪某个项目的版本，请单独添加该仓库。</p>
        </div>
      </div>
    </section>
  );
}

type Candidate = { login: string; id: string };
export function AddSubscription({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdded: () => Promise<void>;
}) {
  const [kind, setKind] = useState<'repo' | 'author' | 'following'>('repo');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [checked, setChecked] = useState<string[]>([]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (kind === 'following' && !candidates.length) {
        const result = await requestJson<{ users: Candidate[]; truncated: boolean }>(
          '/api/github/following/preview',
          'POST',
          { username: value },
        );
        setCandidates(result.users);
        setChecked(result.users.map((x) => x.login));
        if (!result.users.length) setError('这个账号还没有公开关注任何人。');
        else if (result.truncated) setError('当前展示前 50 位关注对象，其他开发者可手动添加。');
      } else {
        if (kind === 'following') {
          const result = await requestJson<{ failed: string[] }>(
            '/api/github/following/import',
            'POST',
            { usernames: checked },
          );
          if (result.failed.length) {
            setError(
              `部分账号未能导入：${result.failed.join('、')}。已导入的账号会保留，请稍后重试。`,
            );
            setChecked(result.failed);
            return;
          }
        } else await requestJson('/api/subscriptions', 'POST', { kind, input: value });
        await onAdded();
        onOpenChange(false);
        setValue('');
        setCandidates([]);
      }
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <Dialog.Close asChild>
            <button className="dialog-close icon-button" aria-label="关闭添加订阅">
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
              ['author', '开发者'],
              ['following', '导入关注'],
            ].map(([key, label]) => (
              <button
                key={key}
                className={kind === key ? 'selected' : ''}
                onClick={() => {
                  setKind(key as typeof kind);
                  setCandidates([]);
                  setError('');
                }}
              >
                {label}
              </button>
            ))}
          </div>
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
                setCandidates([]);
              }}
              placeholder={kind === 'repo' ? '例如 vercel/next.js' : '例如 torvalds'}
              required
              maxLength={200}
            />
            <p className="helper">
              {kind === 'repo'
                ? '跟踪正式版本发布，首次导入的历史版本不会作为新提醒。'
                : kind === 'author'
                  ? '发现该开发者新建的公开仓库，不自动追踪全部项目。'
                  : '读取该账号公开的关注列表，勾选后导入。'}
            </p>
            {candidates.length > 0 && (
              <div className="candidate-list">
                {candidates.map((candidate) => (
                  <label key={candidate.id}>
                    <input
                      type="checkbox"
                      checked={checked.includes(candidate.login)}
                      onChange={(e) =>
                        setChecked(
                          e.target.checked
                            ? [...checked, candidate.login]
                            : checked.filter((x) => x !== candidate.login),
                        )
                      }
                    />
                    <Github size={16} />
                    {candidate.login}
                  </label>
                ))}
              </div>
            )}
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
                disabled={busy || (candidates.length > 0 && !checked.length)}
              >
                {busy ? <Loader2 size={15} className="spin" /> : <Check size={15} />}{' '}
                {kind === 'following' && !candidates.length
                  ? '查看关注列表'
                  : kind === 'following'
                    ? `导入 ${checked.length} 人`
                    : '添加订阅'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
