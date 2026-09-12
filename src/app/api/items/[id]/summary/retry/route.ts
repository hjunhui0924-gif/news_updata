import { api } from '@/server/http';
import { enqueueAi } from '@/server/ai/enqueue';
export const POST = (request: Request, context: { params: Promise<{ id: string }> }) =>
  api(request, async (viewer) => enqueueAi(viewer.id, (await context.params).id, 'summary'));
