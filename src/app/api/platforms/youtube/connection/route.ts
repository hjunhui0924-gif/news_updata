import { api } from '@/server/http';
import { disconnectYouTube, getYouTubeAuthStatus } from '@/server/platforms/youtube-auth';
export const GET = (request: Request) => api(request, (viewer) => getYouTubeAuthStatus(viewer.id));
export const DELETE = (request: Request) => api(request, (viewer) => disconnectYouTube(viewer.id));
