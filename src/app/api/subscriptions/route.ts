import { z } from 'zod';
import { api } from '@/server/http';
import { getSubscriptions } from '@/server/db/store';
import { addSubscription } from '@/server/subscriptions/service';
export const GET = (request: Request) => api(request, (viewer) => getSubscriptions(viewer.id));
export const POST = (request: Request) =>
  api(request, async (viewer) => {
    const input = z
      .object({ kind: z.enum(['repo', 'author']), input: z.string().min(1).max(200) })
      .parse(await request.json());
    return addSubscription(viewer.id, input.kind, input.input);
  });
