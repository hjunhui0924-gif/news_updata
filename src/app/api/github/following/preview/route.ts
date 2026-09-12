import { z } from 'zod';
import { api } from '@/server/http';
import { GitHubConnector } from '@/server/connectors/github';
export const POST = (request: Request) =>
  api(request, async () =>
    new GitHubConnector().following(
      z.object({ username: z.string().min(1).max(39) }).parse(await request.json()).username,
    ),
  );
