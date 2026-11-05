import { api } from '@/server/http';
import {
  deletePersonalAiSettings,
  getPersonalAiSettings,
  savePersonalAiSettings,
} from '@/server/ai/settings';
export const GET = (request: Request) => api(request, (viewer) => getPersonalAiSettings(viewer.id));
export const PUT = (request: Request) =>
  api(request, async (viewer) => savePersonalAiSettings(viewer.id, await request.json()));
export const DELETE = (request: Request) =>
  api(request, async (viewer) => deletePersonalAiSettings(viewer.id, await request.json()));
