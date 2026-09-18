import { api } from '@/server/http';
import { importFollowing } from '@/server/subscriptions/following';
export const POST = (request: Request) =>
  api(request, async (viewer) => importFollowing(viewer.id, await request.json()));
