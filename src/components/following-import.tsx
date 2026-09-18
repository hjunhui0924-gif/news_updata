'use client';

import { useState } from 'react';
import { ArrowUpRight, Check, CodeXml as Github, Loader2 } from 'lucide-react';
import type { GitHubFollowingPreview, GitHubFollowingUser, Subscription } from '@/shared/types';
import { requestJson } from './reader-app';
import { Button } from './ui/button';

type ImportResult = { added: Subscription[]; failed: { name: string; error: string }[] };

export function FollowingImport({
  onAdded,
  onClose,
  onBusyChange,
  authorSubscriptionCount,
}: {
  onAdded: () => Promise<void>;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
  authorSubscriptionCount: number;
}) {
  const [username, setUsername] = useState('');
  const [resolvedUsername, setResolvedUsername] = useState('');
  const [users, setUsers] = useState<GitHubFollowingUser[]>([]);
  const [checked, setChecked] = useState<string[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const remainingSlots = Math.max(0, 50 - authorSubscriptionCount);

  function setWorking(value: boolean) {
    setBusy(value);
    onBusyChange(value);
  }

  async function preview(page = 1) {
    setWorking(true);
    setError('');
    try {
      const result = await requestJson<GitHubFollowingPreview>(
        '/api/github/following/preview',
        'POST',
        { username: page === 1 ? username.trim() || undefined : resolvedUsername, page },
      );
      const previousIds = new Set(page === 1 ? [] : users.map((user) => user.id));
      setUsers((current) => [
        ...new Map(
          [...(page === 1 ? [] : current), ...result.users].map((user) => [user.id, user]),
        ).values(),
      ]);
      setChecked((current) => {
        const retained = page === 1 ? [] : current;
        const slots = Math.max(0, remainingSlots - retained.length);
        const additions = result.users
          .filter((user) => !user.subscribed && (page === 1 || !previousIds.has(user.id)))
          .map((user) => user.login)
          .slice(0, slots);
        return [...new Set([...retained, ...additions])];
      });
      setResolvedUsername(result.username);
      setNextPage(result.nextPage);
      setLoaded(true);
      if (!result.users.length && page === 1) setError('这个账号还没有公开关注任何人。');
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setWorking(false);
    }
  }

  async function importSelection() {
    setWorking(true);
    setError('');
    try {
      const result = await requestJson<ImportResult>('/api/github/following/import', 'POST', {
        usernames: checked,
      });
      const successfulNames = new Set(
        result.added.map((subscription) => subscription.name.toLowerCase()),
      );
      setUsers((current) =>
        current.map((user) =>
          successfulNames.has(user.login.toLowerCase()) ? { ...user, subscribed: true } : user,
        ),
      );
      setChecked((current) =>
        current.filter((login) => !successfulNames.has(login.toLowerCase())),
      );
      if (result.added.length) await onAdded();
      if (result.failed.length) {
        setError(
          `部分账号未能导入：${result.failed.map((failure) => `${failure.name}（${failure.error}）`).join('、')}。已导入的账号会保留，请稍后重试。`,
        );
        return;
      }
      onClose();
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setWorking(false);
    }
  }

  const available = users.filter((user) => !user.subscribed);
  const allAvailableSelected =
    available.length > 0 && checked.length === Math.min(available.length, remainingSlots);
  return (
    <div className="following-import">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void preview();
        }}
      >
        <label className="field-label" htmlFor="following-username">
          GitHub 用户名（可选）
        </label>
        <input
          id="following-username"
          className="text-input"
          placeholder="留空读取当前登录账号，例如 torvalds"
          value={username}
          disabled={busy}
          maxLength={39}
          onChange={(event) => {
            setUsername(event.target.value);
            setLoaded(false);
            setResolvedUsername('');
            setUsers([]);
            setChecked([]);
            setNextPage(null);
            setError('');
          }}
        />
        <p className="helper">
          读取该账号公开关注的开发者，勾选后导入为作者订阅。关注开发者不等于跟踪其参与的所有项目。
        </p>
        <p className="helper following-limit-note">
          作者订阅上限：50 个，当前还可添加 {remainingSlots} 个。
        </p>
        <Button type="submit" disabled={busy} size="small">
          <Github size={15} />
          {loaded ? '重新读取关注' : '查看关注列表'}
        </Button>
      </form>
      {loaded && (
        <>
          <div className="following-selection-bar">
            <span>
              {resolvedUsername} · 已加载 {users.length} 位开发者
            </span>
            <button
              type="button"
              className="text-action"
              disabled={busy || !available.length || !remainingSlots}
              onClick={() =>
                setChecked(
                  allAvailableSelected
                    ? []
                    : available.slice(0, remainingSlots).map((user) => user.login),
                )
              }
            >
              {available.length > 0 && checked.length === available.length
                ? '取消全选'
                : '全选可导入开发者'}
            </button>
          </div>
          <div className="candidate-list following-candidates">
            {users.map((user) => (
              <div className="following-candidate" key={user.id}>
                <label>
                  <input
                    type="checkbox"
                    aria-label={`订阅 ${user.login}`}
                    checked={user.subscribed || checked.includes(user.login)}
                    disabled={busy || user.subscribed || (!checked.includes(user.login) && !remainingSlots)}
                    onChange={(event) =>
                      setChecked((current) => {
                        if (event.target.checked) {
                          if (current.length >= remainingSlots) {
                            setError('已达到作者订阅数量上限，请先取消其他作者订阅。');
                            return current;
                          }
                          return [...current, user.login];
                        }
                        return current.filter((login) => login !== user.login);
                      })
                    }
                  />
                  <span>
                    <strong>{user.login}</strong>
                    <small>{user.subscribed ? '已订阅 · 不会重复添加' : '可导入为作者订阅'}</small>
                  </span>
                </label>
                <a
                  href={`https://github.com/${user.login}`}
                  target="_blank"
                  rel="noreferrer"
                  className="icon-button"
                  aria-label={`在 GitHub 查看 ${user.login}`}
                >
                  <ArrowUpRight size={16} />
                </a>
              </div>
            ))}
          </div>
          {nextPage && (
            <Button size="small" disabled={busy} onClick={() => void preview(nextPage)}>
              加载更多关注
            </Button>
          )}
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-footer">
        <span>仅访问公开信息</span>
        <Button
          variant="primary"
          disabled={busy || !checked.length || !remainingSlots}
          onClick={() => void importSelection()}
        >
          {busy ? <Loader2 className="spin" size={15} /> : <Check size={15} />}导入 {checked.length} 人
        </Button>
      </div>
    </div>
  );
}
