import { z } from 'zod';
import { api } from '@/server/http';
import { updateSubscription, deleteSubscription } from '@/server/subscriptions/service';
type Context = { params: Promise<{ id: string }> };
export const PATCH = (request: Request, context: Context) =>
  api(request, async (viewer) =>
    updateSubscription(
      viewer.id,
      (await context.params).id,
      z
        .object({ enabled: z.boolean().optional(), priority: z.boolean().optional() })
        .strict()
        .refine((x) => Object.keys(x).length > 0)
        .parse(await request.json()),
    ),
  );
export const DELETE = (request: Request, context: Context) =>
  api(request, async (viewer) => {
    await deleteSubscription(viewer.id, (await context.params).id);
    return { ok: true };
  });
