import { redirect, notFound } from 'next/navigation';
import { getViewer, AccessError } from '@/server/auth';
import { bootstrap } from '@/server/feed/bootstrap';
import { ReaderApp } from '@/components/reader-app';
import { Login } from '@/components/login';
import { getConfig } from '@/server/config';
import { getItem } from '@/server/db/store';
import type { Bootstrap } from '@/shared/types';
export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  if (path[0] === 'login') return <Login configured={!!getConfig().GITHUB_CLIENT_ID} />;
  if (path[0] === 'guest' && path.length === 1) {
    const guest: Bootstrap = {
      mode: 'live',
      guest: true,
      user: { name: '访客工作区', image: null },
      items: [],
      subscriptions: [],
      preferences: { compact: false, timezone: 'Asia/Shanghai' },
      notifications: [],
      jobs: [],
      starSync: null,
      services: {
        github: false,
        githubAuth: {
          state: 'configuration_error',
          message: '登录后查看你的 GitHub 连接状态。',
          expiresAt: null,
          retryAt: null,
        },
        youtubeAuth: {
          configured: false,
          state: 'unconfigured',
          name: null,
          message: '登录后连接自己的 YouTube 账号。',
          expiresAt: null,
          retryAt: null,
        },
        ai: false,
        aiMode: 'disabled',
        workerLastSeen: null,
        workerOnline: false,
        costToday: 0,
      },
      feed: { total: 0, unread: 0, saved: 0, nextCursor: null },
    };
    return <ReaderApp initial={guest} initialView="home" />;
  }
  if (!path.length) redirect('/home');
  if (
    ![
      'today',
      'home',
      'help',
      'connections',
      'ai-settings',
      'feed',
      'saved',
      'skills',
      'subscriptions',
      'settings',
      'onboarding',
      'items',
    ].includes(path[0])
  )
    notFound();
  let viewer;
  try {
    viewer = await getViewer();
  } catch (error) {
    if (error instanceof AccessError) redirect('/login');
    throw error;
  }
  if (path.length !== (path[0] === 'items' ? 2 : 1)) notFound();
  const initial = await bootstrap(viewer);
  if (path[0] === 'items') {
    const selected = await getItem(viewer.id, path[1]);
    if (!selected) notFound();
    initial.selectedItem = selected;
  }
  return (
    <ReaderApp
      initial={initial}
      initialView={path[0]}
      initialItemId={path[0] === 'items' ? path[1] : undefined}
    />
  );
}
