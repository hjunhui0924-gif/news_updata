import { api } from '@/server/http';
import { beginYouTubeOAuth, YOUTUBE_OAUTH_COOKIE } from '@/server/platforms/youtube-auth';
import { getConfig } from '@/server/config';

export async function POST(request: Request) {
  let state: string | undefined;
  const response = await api(request, async (viewer) => {
    const authorization = await beginYouTubeOAuth(viewer.id);
    state = authorization.state;
    return { url: authorization.url };
  });
  if (response.ok && state) {
    const secure = new URL(getConfig().APP_URL).protocol === 'https:' ? '; Secure' : '';
    response.headers.append(
      'Set-Cookie',
      `${YOUTUBE_OAUTH_COOKIE}=${state}; Path=/api/platforms/youtube/callback; Max-Age=600; HttpOnly; SameSite=Lax${secure}`,
    );
  }
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
