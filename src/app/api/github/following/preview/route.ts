import { api } from '@/server/http';
import { previewFollowing } from '@/server/subscriptions/following';
export const POST = (request: Request) =>
  api(request, async (viewer) => previewFollowing(viewer.id, await request.json()));
