import { api } from '@/server/http';
import { bootstrap } from '@/server/feed/bootstrap';
export const GET = (request: Request) => api(request, bootstrap);
