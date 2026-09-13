import { z } from 'zod';
import { api } from '@/server/http';
import { setStarSync, requestStarSync } from '@/server/subscriptions/star-sync';
export const PATCH = (request: Request) =>
  api(request, async (viewer) => {
    const { enabled } = z
      .object({ enabled: z.boolean() })
      .strict()
      .parse(await request.json());
    return setStarSync(viewer.id, enabled);
  });
export const POST = (request: Request) => api(request, (viewer) => requestStarSync(viewer.id));
