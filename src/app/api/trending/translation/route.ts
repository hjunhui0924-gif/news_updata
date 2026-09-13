import { z } from 'zod';
import { api } from '@/server/http';
import { AiError } from '@/server/ai/service';
import { GitHubError } from '@/server/connectors/github';
import { getTrending } from '@/server/discovery/service';
import { translateDescription } from '@/server/discovery/translation';

export const POST = (request: Request) =>
  api(request, async (viewer) => {
    const input = z
      .object({ name: z.string().min(1).max(200), language: z.string().max(30).default('') })
      .parse(await request.json());
    const snapshot = await getTrending(input.language);
    const repo = snapshot.repositories.find((repo) => repo.name === input.name);
    if (!repo) throw new GitHubError('此项目已不在当前榜单，请刷新后重试。', 404);
    try {
      return {
        name: repo.name,
        description: repo.description,
        translation: await translateDescription(viewer.id, repo),
      };
    } catch (error) {
      if (error instanceof AiError) throw new GitHubError(error.message, 400);
      throw error;
    }
  });
