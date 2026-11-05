import { NextRequest, NextResponse } from 'next/server';
import { AccessError, getViewer } from '@/server/auth';
import { randomUUID } from 'node:crypto';
import type { YouTubeOAuthRecovery } from '@/shared/youtube-oauth';
import { getConfig } from '@/server/config';
import {
  completeYouTubeOAuth,
  YouTubeOAuthCancelled,
  YouTubeOAuthFailure,
  YOUTUBE_OAUTH_COOKIE,
} from '@/server/platforms/youtube-auth';

export async function GET(request: NextRequest) {
  let result = 'failed';
  let reason: YouTubeOAuthRecovery | undefined;
  let diagnostic: string | undefined;
  const started = performance.now();
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
    else {
      reason =
        error instanceof AccessError
          ? 'session'
          : error instanceof YouTubeOAuthFailure
            ? error.recovery
            : 'temporary';
      diagnostic = randomUUID();
      console.warn('YouTube OAuth failed', {
        diagnostic,
        stage:
          error instanceof AccessError
            ? 'session'
            : error instanceof YouTubeOAuthFailure
              ? error.stage
              : 'unknown',
        reason,
        status:
          error instanceof AccessError || error instanceof YouTubeOAuthFailure ? error.status : 503,
        elapsedMs: Math.round(performance.now() - started),
        ...(error instanceof YouTubeOAuthFailure && error.diagnostic
          ? { causeCode: error.diagnostic.code, upstreamStatus: error.diagnostic.upstreamStatus }
          : {}),
      });
    }
    // Never reflect OAuth codes, state, provider descriptions or arbitrary return URLs.
  }
  const url = new URL('/subscriptions', getConfig().APP_URL);
  url.searchParams.set('youtube', result);
  if (reason) url.searchParams.set('youtubeReason', reason);
  if (diagnostic) url.searchParams.set('youtubeDiagnostic', diagnostic);
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
