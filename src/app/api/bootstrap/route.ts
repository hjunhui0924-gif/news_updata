import { api } from '@/server/http';
import { bootstrap } from '@/server/feed/bootstrap';
export const GET = (request: Request) =>
  api(request, (viewer) =>
    bootstrap(viewer, new URL(request.url).searchParams.get('metadata') === 'true'),
  );
