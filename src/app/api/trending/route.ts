import { api } from '@/server/http';
import { getTrending } from '@/server/discovery/service';
import { withChineseDescriptions } from '@/server/discovery/translation';

export const GET = (request: Request) =>
  api(request, async () => {
    const snapshot = await getTrending(new URL(request.url).searchParams.get('language') ?? '');
    return { ...snapshot, repositories: await withChineseDescriptions(snapshot.repositories) };
  });
