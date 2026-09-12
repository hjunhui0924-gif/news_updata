import { z } from 'zod';
import { api } from '@/server/http';
import { AccessError } from '@/server/auth';
import { patchItemState } from '@/server/db/store';
export const PATCH = async (request: Request, context: { params: Promise<{ id: string }> }) =>
  api(request, async (viewer) => {
    const patch = z
      .object({
        read: z.boolean().optional(),
        saved: z.boolean().optional(),
        muted: z.boolean().optional(),
      })
      .strict()
      .refine((x) => Object.keys(x).length > 0)
      .parse(await request.json());
    if (!(await patchItemState(viewer.id, (await context.params).id, patch)))
      throw new AccessError('更新不存在', 404);
    return { ok: true };
  });
