import { api } from '@/server/http';
import { AccessError } from '@/server/auth';
import { getSubscription } from '@/server/db/store';
import { enqueue } from '@/server/jobs/queue';
export const POST = (request: Request, context: { params: Promise<{ id: string }> }) =>
  api(request, async (viewer) => {
    const sub = await getSubscription(viewer.id, (await context.params).id);
    if (!sub) throw new AccessError('订阅不存在', 404);
    if (!sub.enabled) throw new AccessError('请先恢复订阅', 400);
    if (sub.retryAt && Date.parse(sub.retryAt) > Date.now())
      throw new AccessError('GitHub 限流等待中，请稍后重试。', 429);
    return enqueue(viewer.id, 'sync', sub.id);
  });
