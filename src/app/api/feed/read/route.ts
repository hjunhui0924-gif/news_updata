import { api } from '@/server/http';
import { markFeedRead } from '@/server/db/store';
import { feedQuerySchema } from '@/server/feed/query';

export const POST = (request: Request) =>
  api(request, async (viewer) => {
    const filters = feedQuerySchema.omit({ cursor: true }).parse(await request.json());
    return { changed: await markFeedRead(viewer.id, filters) };
  });
