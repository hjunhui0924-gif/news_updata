import { redirect, notFound } from 'next/navigation';
import { getViewer, AccessError } from '@/server/auth';
import { bootstrap } from '@/server/feed/bootstrap';
import { ReaderApp } from '@/components/reader-app';
import { Login } from '@/components/login';
import { getConfig } from '@/server/config';
export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  if (path[0] === 'login') return <Login configured={!!getConfig().GITHUB_CLIENT_ID} />;
  if (!path.length) redirect('/today');
  if (
    !['today', 'feed', 'saved', 'skills', 'subscriptions', 'settings', 'onboarding', 'items'].includes(
      path[0],
    )
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
  if (path[0] === 'items' && !initial.items.some((item) => item.id === path[1])) notFound();
  return (
    <ReaderApp
      initial={initial}
      initialView={path[0]}
      initialItemId={path[0] === 'items' ? path[1] : undefined}
    />
  );
}
