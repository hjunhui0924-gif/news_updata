import { api } from '@/server/http';
import { buildDigest } from '@/server/notifications/digest';
export const POST = (request: Request) => api(request, (viewer) => buildDigest(viewer.id));
