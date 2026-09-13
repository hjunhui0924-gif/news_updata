import { api } from '@/server/http';
import { searchRepositories } from '@/server/subscriptions/search';
export const POST = (request: Request) =>
  api(request, async (viewer) =>
    searchRepositories(viewer.id, await request.json(), undefined, request.signal),
  );
