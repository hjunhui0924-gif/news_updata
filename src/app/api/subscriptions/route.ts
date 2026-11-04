import { z } from 'zod';
import { api } from '@/server/http';
import { getSubscriptions } from '@/server/db/store';
import { addSubscription } from '@/server/subscriptions/service';
export const GET = (request: Request) => api(request, (viewer) => getSubscriptions(viewer.id));
export const POST = (request: Request) =>
  api(request, async (viewer) => {
    const input = z
      .object({
        platform: z.enum(['github', 'youtube']).default('github'),
        kind: z.enum(['repo', 'author', 'channel']),
        input: z.string().trim().min(1).max(200),
      })
      .parse(await request.json());
    return addSubscription(viewer.id, input.kind, input.input, undefined, input.platform);
  });
