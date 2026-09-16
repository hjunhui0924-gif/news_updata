import { z } from 'zod';
import { api } from '@/server/http';
import { enqueueUserSkillAi } from '@/server/skills/service';

const inputSchema = z.object({
  id: z.string().trim().min(1).max(1000),
  kind: z.enum(['summary', 'translation']),
});

export const POST = (request: Request) =>
  api(request, async (viewer) => {
    const input = inputSchema.parse(await request.json());
    return enqueueUserSkillAi(viewer.id, input.id, input.kind, request.signal);
  });
