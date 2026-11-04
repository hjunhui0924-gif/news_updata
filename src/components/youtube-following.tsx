'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Loader2, Play } from 'lucide-react';
import type {
  Subscription,
  YouTubeConnectionStatus,
  YouTubeFollowingChannel,
  YouTubeFollowingPreview,
} from '@/shared/types';
import { Button } from './ui/button';
import { requestJson, RequestError } from './request-json';
import { importReceiptMessage, type ImportReceipt } from '@/shared/import-receipt';

export function YouTubeFollowing({
  connection,
  callbackError,
  onDismissCallbackError,
  subscriptionCount,
  intervalMinutes,
  onBusyChange,
  onAdded,
  onRefresh,
}: {
  connection?: YouTubeConnectionStatus;
  callbackError?: string;
  onDismissCallbackError?: () => void;
  subscriptionCount: number;
  intervalMinutes: number;
  onBusyChange: (busy: boolean) => void;
  onAdded: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(callbackError ?? '');
  const [notice, setNotice] = useState('');
  const [channels, setChannels] = useState<YouTubeFollowingChannel[]>([]);
  const [checked, setChecked] = useState<string[]>([]);
  const [previewId, setPreviewId] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [imported, setImported] = useState(0);
  const [initialCount] = useState(subscriptionCount);
  const [localConnection, setLocalConnection] = useState<YouTubeConnectionStatus>();
  const footer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (notice || error) footer.current?.scrollIntoView({ block: 'nearest' });
  }, [notice, error]);
  const status = localConnection ?? connection;
  const connected =
    status && ['connected', 'refresh_pending', 'temporary_error'].includes(status.state);
  // Use local success counts too: refreshing the surrounding reader may temporarily fail.
  const remaining = Math.max(0, 50 - Math.max(subscriptionCount, imported + initialCount));
  const available = channels.filter((channel) => !channel.subscribed);
  function invalidatePreview() {
    setChannels([]);
    setChecked([]);
    setPreviewId('');
    setCursor(null);
    setTruncated(false);
  }
  function handleError(error: unknown) {
    if (error instanceof RequestError && error.status === 409) invalidatePreview();
    setError((error as Error).message);
  }
  function working(value: boolean) {
    if (value) onDismissCallbackError?.();
    setBusy(value);
    onBusyChange(value);
  }
  async function connect() {
    working(true);
    setError('');
    setNotice('');
    try {
      const result = await requestJson<{ url: string }>('/api/platforms/youtube/connect', 'POST');
      const url = new URL(result.url);
      if (url.origin !== 'https://accounts.google.com') throw new Error('授权地址无效，请重试。');
      window.location.assign(url.href);
    } catch (error) {
      setError((error as Error).message);
      working(false);
    }
  }
  async function disconnect() {
    if (!window.confirm('断开 YouTube 账号？已导入的频道和历史会保留，后台更新将等待重新连接。'))
      return;
    working(true);
    setError('');
    setNotice('');
    try {
      const result = await requestJson<{ connection: YouTubeConnectionStatus; revoked: boolean }>(
        '/api/platforms/youtube/connection',
        'DELETE',
      );
      setLocalConnection(result.connection);
      setChannels([]);
      setChecked([]);
      setPreviewId('');
      setCursor(null);
      setNotice(
        result.revoked
          ? '已断开 YouTube 账号。'
          : '本地连接已清除；Google 授权撤销未确认，可在 Google 账号的第三方应用权限中移除。',
      );
      try {
        await onRefresh();
      } catch {
        setError('连接已断开，但页面刷新失败，请刷新页面。');
      }
    } catch (error) {
      setError((error as Error).message);
    } finally {
      working(false);
    }
  }
  async function preview(more = false) {
    working(true);
    setError('');
    setNotice('');
    try {
      const result = await requestJson<YouTubeFollowingPreview>(
        '/api/platforms/youtube/following/preview',
        'POST',
        more ? { previewId, cursor } : {},
      );
      const existing = new Set(more ? channels.map((channel) => channel.id) : []);
      setChannels((current) => [
        ...new Map(
          [...(more ? current : []), ...result.channels].map((channel) => [channel.id, channel]),
        ).values(),
      ]);
      setChecked((current) => {
        const retained = more ? current : [];
        const additions = result.channels
          .filter((channel) => !channel.subscribed && !existing.has(channel.id))
          .map((channel) => channel.id)
          .slice(0, Math.max(0, remaining - retained.length));
        return [...retained, ...additions];
      });
      setPreviewId(result.previewId);
      setCursor(result.nextCursor);
      setTruncated(result.truncated);
    } catch (error) {
      handleError(error);
    } finally {
      working(false);
    }
  }
  async function importSelection() {
    working(true);
    setError('');
    setNotice('');
    try {
      const result = await requestJson<{
        added: Subscription[];
        failed: { id: string; name: string; error: string }[];
        receipt?: ImportReceipt;
        previewInvalidated?: boolean;
      }>('/api/platforms/youtube/following/import', 'POST', { previewId, channelIds: checked });
      const successful = new Set(result.added.map((subscription) => subscription.externalId));
      setChannels((current) =>
        current.map((channel) =>
          successful.has(channel.id) ? { ...channel, subscribed: true } : channel,
        ),
      );
      setChecked((current) => current.filter((id) => !successful.has(id)));
      setImported(
        (current) =>
          current +
          result.added.filter(
            (subscription) =>
              !channels.find((channel) => channel.id === subscription.externalId)?.subscribed,
          ).length,
      );
      setNotice(
        importReceiptMessage(
          result.receipt ?? {
            created: result.added.length,
            existing: 0,
            failed: result.failed.length,
          },
          '个频道',
        ),
      );
      if (result.previewInvalidated) invalidatePreview();
      if (result.failed.length)
        setError(
          `部分频道未能导入：${result.failed.map((failure) => `${failure.name}（${failure.error}）`).join('、')}。已导入的会保留，可重试剩余选择。`,
        );
      if (result.added.length) {
        try {
          await onAdded();
        } catch {
          setError((current) => `${current} 频道已保存，但页面刷新失败，请刷新页面。`.trim());
        }
      }
      if (result.previewInvalidated && !result.added.length) {
        try {
          await onRefresh();
        } catch {
          /* The visible error still asks for an explicit reread. */
        }
      }
    } catch (error) {
      handleError(error);
    } finally {
      working(false);
    }
  }
  const feedback = (
    <>
      {notice && (
        <p className="helper" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
  return (
    <div className="following-import youtube-following">
      <div className="youtube-connection">
        <strong>
          <Play size={16} />
          {status?.name ?? '连接自己的 YouTube 账号'}
        </strong>
        <p className="helper">{status?.message ?? '尚未配置 YouTube 账号授权。'}</p>
        <p className="helper">
          仅申请读取账号与订阅频道的权限，不修改你的关注。无需在本站输入 Google 密码。
        </p>
        {!status?.configured && (
          <p className="form-error" role="status">
            请在服务端配置 YOUTUBE_CLIENT_ID、YOUTUBE_CLIENT_SECRET 和回调地址，并启用 YouTube Data
            API v3。
          </p>
        )}
        <div className="youtube-connection-actions">
          <Button
            size="small"
            variant={connected ? 'secondary' : 'primary'}
            disabled={busy || !status?.configured}
            onClick={() => void connect()}
          >
            {connected ? '重新授权 YouTube' : '连接 YouTube 账号'}
          </Button>
          {status?.configured &&
            status.state !== 'disconnected' &&
            status.state !== 'unconfigured' && (
              <Button size="small" disabled={busy} onClick={() => void disconnect()}>
                断开账号
              </Button>
            )}
        </div>
      </div>
      {connected && (
        <>
          <p className="helper">
            读取自己的关注，勾选后导入；以后新增关注可再次读取。已导入频道每 {intervalMinutes}{' '}
            分钟检查新视频，取消源站关注不会删除本地订阅。
          </p>
          <p className="helper following-limit-note">
            频道订阅上限：50 个，当前还可添加 {remaining} 个。仅展示公开视频简介，跳转 YouTube
            观看。
          </p>
          <Button size="small" disabled={busy} onClick={() => void preview()}>
            {busy ? <Loader2 size={15} className="spin" /> : <Play size={15} />}
            {previewId ? '重新读取我的关注' : '读取我的关注'}
          </Button>
          {previewId && (
            <>
              <div className="following-selection-bar">
                <span>已加载 {channels.length} 个关注频道</span>
                <button
                  type="button"
                  className="text-action"
                  disabled={busy || !available.length || !remaining}
                  onClick={() =>
                    setChecked(
                      checked.length === Math.min(available.length, remaining)
                        ? []
                        : available.slice(0, remaining).map((channel) => channel.id),
                    )
                  }
                >
                  {checked.length && checked.length === Math.min(available.length, remaining)
                    ? '取消全选'
                    : '全选可导入频道'}
                </button>
              </div>
              {!channels.length && (
                <p className="helper" role="status">
                  这个账号还没有可读取的关注频道。
                </p>
              )}
              <div className="candidate-list following-candidates">
                {channels.map((channel) => (
                  <div className="following-candidate" key={channel.id}>
                    <label>
                      <input
                        type="checkbox"
                        aria-label={`订阅 ${channel.name}`}
                        checked={channel.subscribed || checked.includes(channel.id)}
                        disabled={
                          busy ||
                          channel.subscribed ||
                          (!checked.includes(channel.id) && checked.length >= remaining)
                        }
                        onChange={(event) =>
                          setChecked((current) =>
                            event.target.checked
                              ? [...current, channel.id].slice(0, remaining)
                              : current.filter((id) => id !== channel.id),
                          )
                        }
                      />
                      <span>
                        <strong>{channel.name}</strong>
                        <small>
                          {channel.subscribed
                            ? '已订阅 · 不会重复添加'
                            : channel.description || '可导入为视频频道'}
                        </small>
                      </span>
                    </label>
                    <a
                      className="icon-button"
                      href={`https://www.youtube.com/channel/${channel.id}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`在 YouTube 查看 ${channel.name}`}
                    >
                      <ArrowUpRight size={16} />
                    </a>
                  </div>
                ))}
              </div>
              {cursor && (
                <Button size="small" disabled={busy} onClick={() => void preview(true)}>
                  加载更多关注
                </Button>
              )}
              {truncated && (
                <p className="helper">本次最多读取 1000 个关注频道，请先导入需要的频道。</p>
              )}
            </>
          )}
          {feedback}
          <div className="dialog-footer" ref={footer}>
            <span>只读授权 · 不修改源站关注</span>
            <Button
              variant="primary"
              disabled={busy || !checked.length}
              onClick={() => void importSelection()}
            >
              {busy ? <Loader2 size={15} className="spin" /> : <Check size={15} />}导入{' '}
              {checked.length} 个频道
            </Button>
          </div>
        </>
      )}
      {!connected && feedback}
    </div>
  );
}
