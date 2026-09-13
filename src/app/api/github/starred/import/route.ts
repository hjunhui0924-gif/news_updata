import { api } from '@/server/http';
import { importStarred } from '@/server/subscriptions/starred';
export const POST = (request: Request) =>
  api(request, async (viewer) => importStarred(viewer.id, await request.json()));
