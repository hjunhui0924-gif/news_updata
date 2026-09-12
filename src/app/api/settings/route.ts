import { z } from 'zod';
import { api } from '@/server/http';
import { savePreferences, getPreferences } from '@/server/db/store';
const settingsSchema = z
  .object({
    timezone: z.string().refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, '时区无效'),
    compact: z.boolean(),
  })
  .strict();
export const GET = (request: Request) => api(request, (viewer) => getPreferences(viewer.id));
export const PATCH = (request: Request) =>
  api(request, async (viewer) => {
    const settings = settingsSchema.parse(await request.json());
    await savePreferences(viewer.id, settings);
    return settings;
  });
