import { api } from '@/server/http';
import { listUserStarredSkillCatalog } from '@/server/skills/service';

export const GET = (request: Request) =>
  api(request, async (viewer) => {
    const page = Number(new URL(request.url).searchParams.get('page') ?? '1');
    return listUserStarredSkillCatalog(viewer.id, page, request.signal);
  });
