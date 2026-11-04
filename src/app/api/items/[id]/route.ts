import { api } from '@/server/http';
import { AccessError } from '@/server/auth';
import { getItem } from '@/server/db/store';
export const GET = (request: Request, context: { params: Promise<{ id: string }> }) =>
  api(request, async (viewer) => {
    const item = await getItem(viewer.id, (await context.params).id);
    if (!item) throw new AccessError('更新不存在或已移除。', 404);
    return item;
  });
