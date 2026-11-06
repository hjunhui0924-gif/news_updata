'use client';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  BookOpen,
  Check,
  ChevronUp,
  Home,
  Loader2,
  LogOut,
  Settings2,
  Sparkles,
  UserRound,
} from 'lucide-react';
import type { Bootstrap } from '@/shared/types';
import { requestJson } from './request-json';

export function AccountMenu({
  data,
  idPrefix,
  navigate,
}: {
  data: Bootstrap;
  idPrefix: string;
  navigate: (view: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const name = data.guest
    ? '访客工作区'
    : data.mode === 'demo'
      ? '体验工作空间'
      : data.user.name || '我的账号';
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() =>
      menu.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
        ?.focus({ preventScroll: true }),
    );
    const outside = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    // Consume Escape before the enclosing mobile Dialog sees it.
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', escape, true);
    };
  }, [open]);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  function keys(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = [
      ...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ??
        []),
    ];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
    items[next]?.focus();
  }
  async function logout() {
    if (!window.dispatchEvent(new Event('newsroom:navigate', { cancelable: true }))) return;
    setBusy(true);
    setError('');
    try {
      await requestJson('/api/auth/sign-out', 'POST', {});
      window.dispatchEvent(new Event('newsroom:leave-confirmed'));
      window.location.replace('/login');
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="account-menu-wrap" ref={wrap}>
      <button
        type="button"
        className={`user-row account-trigger ${open ? 'is-open' : ''}`}
        ref={trigger}
        aria-label="账号菜单"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `account-menu-${idPrefix}` : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="user-avatar" aria-hidden="true">
          {name.slice(0, 1).toUpperCase()}
        </span>
        <span className="account-trigger-copy">
          <strong>{name}</strong>
          <span>
            {data.guest
              ? '未登录空工作区'
              : data.mode === 'demo'
                ? '本地演示工作空间'
                : '个人账号与偏好'}
          </span>
        </span>
        <ChevronUp size={16} aria-hidden="true" />
      </button>
      {open && (
        <div
          className="account-popover"
          id={`account-menu-${idPrefix}`}
          role="menu"
          aria-label="个人账号"
          ref={menu}
          onKeyDown={keys}
        >
          <div className="account-popover-heading">
            <span className="user-avatar" aria-hidden="true">
              {name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{name}</strong>
              <span>
                <Check size={12} />
                {data.guest
                  ? '仅浏览空工作区'
                  : data.mode === 'demo'
                    ? '演示模式'
                    : '已登录工作空间'}
              </span>
            </div>
          </div>
          {[
            { label: '工作空间首页', view: 'home', icon: Home },
            { label: '阅读偏好', view: 'settings', icon: Settings2 },
            { label: '账号与连接', view: 'connections', icon: UserRound },
            { label: '个人 AI 服务', view: 'ai-settings', icon: Sparkles },
            { label: '使用帮助', view: 'help', icon: BookOpen },
          ].map(({ label, view, icon: Icon }) => (
            <button
              key={view}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                close();
                navigate(view);
              }}
            >
              <Icon size={17} />
              <span>{label}</span>
            </button>
          ))}
          <div className="account-menu-divider" />
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="account-signout"
            disabled={busy || data.mode === 'demo' || data.guest}
            onClick={() => void logout()}
          >
            {busy ? <Loader2 size={17} className="spin" /> : <LogOut size={17} />}
            <span>
              {data.guest
                ? '访客模式请先登录'
                : data.mode === 'demo'
                  ? '演示模式无需退出'
                  : busy
                    ? '正在退出…'
                    : '退出登录'}
            </span>
          </button>
          {error && (
            <p role="alert" className="account-menu-error">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
