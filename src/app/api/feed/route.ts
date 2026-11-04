import { api } from '@/server/http';
import { getFeedPage, getFeedStatus } from '@/server/db/store';
import { feedQuerySchema } from '@/server/feed/query';

export const GET = (request: Request) =>
  api(request, async (viewer) => {
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    const query = feedQuerySchema.parse(params);
    return params.status === 'true'
      ? getFeedStatus(viewer.id, query)
      : getFeedPage(viewer.id, query);
  });
