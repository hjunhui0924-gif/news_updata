'use client';
import { useState } from 'react';
import { ArrowUpRight, Check, Loader2, Star } from 'lucide-react';
import type { StarredPreview, StarredRepository, Subscription } from '@/shared/types';
import { requestJson } from './reader-app';
import { Button } from './ui/button';

type ImportResult = { added: Subscription[]; failed: { name: string; error: string }[] };
export function StarredImport({
  onAdded,
  onClose,
  onBusyChange,
}: {
  onAdded: () => Promise<void>;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [username, setUsername] = useState('');
  const [resolvedUsername, setResolvedUsername] = useState('');
  const [repositories, setRepositories] = useState<StarredRepository[]>([]);
  const [checked, setChecked] = useState<string[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function setWorking(value: boolean) {
    setBusy(value);
    onBusyChange(value);
  }

  async function preview(page = 1) {
    setWorking(true);
    setError('');
    try {
      const result = await requestJson<StarredPreview>('/api/github/starred/preview', 'POST', {
        username: page === 1 ? username.trim() || undefined : resolvedUsername,
        page,
      });
      setResolvedUsername(result.username);
      setRepositories((current) => [
        ...new Map(
          [...(page === 1 ? [] : current), ...result.repositories].map((repo) => [repo.id, repo]),
        ).values(),
      ]);
      setChecked((current) => [
        ...new Set([
          ...(page === 1 ? [] : current),
          ...result.repositories
            .filter(
              (repo) =>
                !repo.subscribed &&
                (page === 1 || !repositories.some((previous) => previous.id === repo.id)),
            )
            .map((repo) => repo.name),
        ]),
      ]);
      setNextPage(result.nextPage);
      setLoaded(true);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setWorking(false);
    }
  }
  async function importSelection() {
    setWorking(true);
    setError('');
    const selection = [...checked];
    const failures: ImportResult['failed'] = [];
    let imported = 0;
    let unexpectedError = '';
    try {
      for (let offset = 0; offset < selection.length; offset += 20) {
        const result = await requestJson<ImportResult>('/api/github/starred/import', 'POST', {
          repositories: selection.slice(offset, offset + 20),
        });
        const successfulIds = new Set(result.added.map((sub) => sub.externalId));
        const successfulNames = new Set(result.added.map((sub) => sub.name.toLowerCase()));
        imported += result.added.length;
        failures.push(...result.failed);
        setRepositories((current) =>
          current.map((repo) =>
            successfulIds.has(repo.id) ? { ...repo, subscribed: true } : repo,
          ),
        );
        setChecked((current) => current.filter((name) => !successfulNames.has(name.toLowerCase())));
      }
    } catch (error) {
      unexpectedError = (error as Error).message;
    }
    try {
      if (imported) await onAdded();
    } catch {
      unexpectedError ||= '订阅已保存，但页面刷新失败，请重新打开订阅管理。';
    }
    setWorking(false);
    if (unexpectedError || failures.length) {
      setError(
        [
          imported ? `已导入 ${imported} 个仓库。` : '',
          ...failures.map((failure) => `${failure.name}：${failure.error}`),
          unexpectedError,
        ]
          .filter(Boolean)
          .join(' '),
      );
    } else {
      onClose();
    }
  }
  const available = repositories.filter((repo) => !repo.subscribed);
  return (
    <div className="starred-import">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void preview();
        }}
      >
        <label className="field-label" htmlFor="starred-username">
          GitHub 用户名（可选）
        </label>
        <input
          id="starred-username"
          className="text-input"
          placeholder="留空读取当前登录账号的 Star"
          value={username}
          disabled={busy}
          maxLength={200}
          onChange={(event) => {
            setUsername(event.target.value);
            setLoaded(false);
            setRepositories([]);
            setChecked([]);
            setNextPage(null);
            setError('');
          }}
        />
        <p className="helper">
          读取 Star 仓库并勾选订阅。导入后自动跟踪正式 Release；没有 Release
          的仓库暂不产生版本消息。
        </p>
        <Button type="submit" disabled={busy} size="small">
          <Star size={15} />
          {loaded ? '重新读取 Star' : '读取 Star 列表'}
        </Button>
      </form>
      {loaded && (
        <>
          <div className="starred-selection-bar">
            <span>
              {resolvedUsername} · 已加载 {repositories.length} 个仓库
            </span>
            <button
              type="button"
              className="text-action"
              disabled={busy || !available.length}
              onClick={() =>
                setChecked(
                  checked.length === available.length ? [] : available.map((repo) => repo.name),
                )
              }
            >
              {available.length > 0 && checked.length === available.length
                ? '取消全选'
                : '全选可导入仓库'}
            </button>
          </div>
          {!repositories.length && <p className="helper">这个账号还没有公开 Star 仓库。</p>}
          <div className="candidate-list starred-candidates">
            {repositories.map((repo) => (
              <div className="starred-candidate" key={repo.id}>
                <label>
                  <input
                    type="checkbox"
                    aria-label={`订阅 ${repo.name}`}
                    checked={repo.subscribed || checked.includes(repo.name)}
                    disabled={busy || repo.subscribed}
                    onChange={(event) =>
                      setChecked((current) =>
                        event.target.checked
                          ? [...current, repo.name]
                          : current.filter((name) => name !== repo.name),
                      )
                    }
                  />
                  <span>
                    <strong>{repo.name}</strong>
                    <small>
                      {repo.subscribed
                        ? '已订阅 · 不会重复添加'
                        : repo.description || '暂无项目描述'}
                    </small>
                  </span>
                </label>
                <a
                  href={repo.url}
                  target="_blank"
                  rel="noreferrer"
                  className="icon-button"
                  aria-label={`在 GitHub 查看 ${repo.name}`}
                >
                  <ArrowUpRight size={16} />
                </a>
              </div>
            ))}
          </div>
          {nextPage && (
            <Button size="small" disabled={busy} onClick={() => void preview(nextPage)}>
              加载更多 Star
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
        <span>新增 Star 后可再次导入</span>
        <Button
          variant="primary"
          disabled={busy || !checked.length}
          onClick={() => void importSelection()}
        >
          {busy ? <Loader2 className="spin" size={15} /> : <Check size={15} />}导入 {checked.length}{' '}
          个仓库
        </Button>
      </div>
    </div>
  );
}
