import { api } from '@/server/http';
import { listLocalSkillCatalog } from '@/server/skills/service';

export const GET = (request: Request) => api(request, async () => listLocalSkillCatalog());
