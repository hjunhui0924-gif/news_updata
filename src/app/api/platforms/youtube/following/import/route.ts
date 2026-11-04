import { api } from '@/server/http';
import { importYouTubeFollowing } from '@/server/platforms/youtube-following';
export const POST = (request: Request) =>
  api(request, async (viewer) =>
    importYouTubeFollowing(viewer.id, await request.json(), request.signal),
  );
