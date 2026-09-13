'use client';
import { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import type { GitHubAuthStatus } from '@/shared/types';
import { Button } from './ui/button';

export function GitHubConnection({
  status,
  onChecked,
  banner = false,
}: {
  status?: GitHubAuthStatus;
  onChecked: () => Promise<unknown>;
  banner?: boolean;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  if (
    !status ||
    (banner &&
      !['reconnect_required', 'temporary_error', 'configuration_error'].includes(status.state))
  )
    return null;
  async function check() {
    setBusy('check');
    setError('');
    try {
      const response = await fetch('/api/github/connection', { method: 'POST' });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '检查连接失败，请稍后重试。');
      }
      await onChecked();
    } catch (error) {
      setError(error instanceof Error ? error.message : '检查连接失败，请稍后重试。');
    } finally {
      setBusy('');
    }
  }
  async function reconnect() {
    setBusy('login');
    setError('');
    try {
      const response = await fetch('/api/auth/sign-in/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'github', callbackURL: '/settings' }),
      });
      const data = await response.json();
      if (!response.ok || !data.url) throw new Error('无法开始 GitHub 登录，请稍后重试。');
      const target = new URL(data.url);
      if (target.protocol !== 'https:' || target.hostname !== 'github.com')
        throw new Error('登录地址异常，请检查服务配置。');
      window.location.assign(target.href);
    } catch (error) {
      setError(error instanceof Error ? error.message : '登录未完成，请重试。');
      setBusy('');
    }
  }
  return (
    <div className={`github-connection ${banner ? 'connection-banner' : ''}`}>
      <div role="status" aria-label="GitHub 授权状态">
        <strong>
          {status.state === 'reconnect_required'
            ? 'GitHub 需要重新连接'
            : status.state === 'temporary_error'
              ? 'GitHub 暂时无法连接'
              : 'GitHub 授权状态'}
        </strong>
        <p>{status.message}</p>
        {!banner && status.expiresAt && (
          <p className="helper">
            当前访问凭据到期：{new Date(status.expiresAt).toLocaleString('zh-CN')}
            。此时间不等于网页登录到期。
          </p>
        )}
      </div>
      <div className="connection-actions">
        {status.state === 'reconnect_required' || status.state === 'public' ? (
          <Button size="small" disabled={!!busy} onClick={reconnect}>
            {busy === 'login' && <Loader2 size={15} className="spin" />}重新连接 GitHub
          </Button>
        ) : null}
        <Button size="small" disabled={!!busy} onClick={check}>
          {busy === 'check' ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
          检查连接
        </Button>
      </div>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </div>
  );
}
