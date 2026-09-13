import { api } from '@/server/http';
import { previewStarred } from '@/server/subscriptions/starred';
export const POST = (request: Request) =>
  api(request, async (viewer) => previewStarred(viewer.id, await request.json()));
