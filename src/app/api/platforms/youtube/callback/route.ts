import { NextRequest, NextResponse } from 'next/server';
import { getViewer } from '@/server/auth';
import { getConfig } from '@/server/config';
import {
  completeYouTubeOAuth,
  YouTubeOAuthCancelled,
  YOUTUBE_OAUTH_COOKIE,
} from '@/server/platforms/youtube-auth';

export async function GET(request: NextRequest) {
  let result = 'failed';
  try {
    const viewer = await getViewer(request.headers);
    const query = request.nextUrl.searchParams;
    await completeYouTubeOAuth(
      viewer.id,
      {
        state: query.get('state') ?? '',
        cookie: request.cookies.get(YOUTUBE_OAUTH_COOKIE)?.value ?? '',
        code: query.get('code'),
        error: query.get('error'),
      },
      fetch,
      request.signal,
    );
    result = 'connected';
  } catch (error) {
    if (error instanceof YouTubeOAuthCancelled) result = 'cancelled';
    // Never reflect OAuth codes, state, provider descriptions or arbitrary return URLs.
  }
  const url = new URL('/subscriptions', getConfig().APP_URL);
  url.searchParams.set('youtube', result);
  const response = NextResponse.redirect(url, 303);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.cookies.set(YOUTUBE_OAUTH_COOKIE, '', {
    maxAge: 0,
    path: '/api/platforms/youtube/callback',
    httpOnly: true,
    sameSite: 'lax',
    secure: url.protocol === 'https:',
  });
  return response;
}
