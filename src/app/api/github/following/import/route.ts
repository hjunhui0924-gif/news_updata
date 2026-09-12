import { z } from 'zod';
import { api } from '@/server/http';
import { addSubscription } from '@/server/subscriptions/service';
export const POST = (request: Request) =>
  api(request, async (viewer) => {
    const { usernames } = z
      .object({ usernames: z.array(z.string().min(1).max(39)).min(1).max(50) })
      .parse(await request.json());
    const added = [];
    const failed: string[] = [];
    for (const name of new Set(usernames)) {
      try {
        added.push(await addSubscription(viewer.id, 'author', name));
      } catch {
        failed.push(name);
      }
    }
    return { added, failed };
  });
