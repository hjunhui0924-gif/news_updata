'use client';
import { RefreshCw, Star } from 'lucide-react';
import type { StarSyncStatus } from '@/shared/types';
import { Button } from './ui/button';

export function StarSyncPanel({
  status,
  pending,
  busy,
  workerOnline,
  onAction,
}: {
  status: StarSyncStatus | null;
  pending: boolean;
  busy: boolean;
  workerOnline: boolean;
  onAction: (action: 'check' | 'enable' | 'disable') => Promise<void>;
}) {
  const enabled = status?.enabled ?? false;
  return (
    <section className="star-sync-panel" aria-labelledby="star-sync-title">
      <div className="star-sync-heading">
        <h2 id="star-sync-title">
          <Star size={18} />
          Star 自动跟踪
        </h2>
        <label className="star-sync-toggle">
          <span>{enabled ? '已开启' : '已关闭'}</span>
          <button
            type="button"
            className={`switch ${enabled ? 'on' : ''}`}
            role="switch"
            aria-label="Star 自动跟踪"
            aria-checked={enabled}
            disabled={busy}
            onClick={() => onAction(enabled ? 'disable' : 'enable')}
          >
            <span />
          </button>
        </label>
      </div>
      <p>
        每 {status?.intervalMinutes ?? 5} 分钟检查当前 GitHub 账号，新 Star
        的公开仓库会自动加入版本订阅。
      </p>
      <div className="star-sync-state">
        <div aria-live="polite">
          <strong>
            {!enabled
              ? '自动检查已关闭'
              : pending
                ? '正在检查 Star 列表…'
                : status?.nextPage && status.nextPage > 1
                  ? '正在分批检查，稍后继续'
                  : status?.lastSyncAt
                    ? `上次检查新增 ${status.lastAdded} 个订阅`
                    : '等待首次自动检查'}
          </strong>
          {status?.lastSyncAt && (
            <span>上次完成 {new Date(status.lastSyncAt).toLocaleString('zh-CN')}</span>
          )}
          {enabled && !pending && status && (
            <span>下次检查 {new Date(status.nextSyncAt).toLocaleTimeString('zh-CN')}</span>
          )}
        </div>
        <Button
          size="small"
          disabled={!enabled || pending || busy}
          onClick={() => onAction('check')}
        >
          <RefreshCw size={15} className={pending ? 'spin' : ''} />
          {pending ? '检查中…' : '立即检查'}
        </Button>
      </div>
      {status?.error && (
        <p className="error-text" role="alert">
          {status.error}
        </p>
      )}
      {enabled && !workerOnline && (
        <p className="warning-text" role="status">
          后台同步服务未连接，恢复后会继续检查。
        </p>
      )}
      <p className="star-sync-hint">
        取消 GitHub Star 会保留订阅；在这里取消订阅的项目不会被自动加回。仅跟踪正式版本发布。
      </p>
    </section>
  );
}
