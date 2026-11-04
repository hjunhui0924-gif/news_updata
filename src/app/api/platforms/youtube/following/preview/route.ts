import { api } from '@/server/http';
import { previewYouTubeFollowing } from '@/server/platforms/youtube-following';
export const POST = (request: Request) =>
  api(request, async (viewer) =>
    previewYouTubeFollowing(viewer.id, await request.json(), request.signal),
  );
