import { api } from '@/server/http';
import { GitHubError } from '@/server/connectors/github';
import { getUserSkillDetails } from '@/server/skills/service';

export const GET = (request: Request) =>
  api(request, async (viewer) => {
    const id = new URL(request.url).searchParams.get('id') ?? '';
    const skill = await getUserSkillDetails(viewer.id, id, request.signal);
    if (!skill) throw new GitHubError('Skill 不存在或已不可读取。', 404);
    return skill;
  });
