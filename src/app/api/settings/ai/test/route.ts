import { api } from '@/server/http';
import { revisionSchema } from '@/server/ai/settings';
import { testPersonalAiConnection } from '@/server/ai/connection-test';
export const POST = (request: Request) =>
  api(request, async (viewer) => {
    const { revision } = revisionSchema.parse(await request.json());
    return testPersonalAiConnection(viewer.id, revision);
  });
