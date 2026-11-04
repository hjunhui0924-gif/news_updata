import {
  beginYouTubeOAuth,
  completeYouTubeOAuth,
  YOUTUBE_READ_SCOPE,
} from '../../src/server/platforms/youtube-auth';

export const youtubeTestChannel = `UC${'a'.repeat(22)}`;
export function googleFixture() {
  const requests: { url: URL; init?: RequestInit }[] = [];
  const state = {
    subject: 'google-test-subject',
    scopes: `openid ${YOUTUBE_READ_SCOPE}`,
    refreshError: '',
    omitRefresh: false,
    nextAccess: 'refreshed-access-token',
    refreshCount: 0,
    subscriptionPages: new Map<string, unknown>(),
    missingChannels: new Set<string>(),
  };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    if (url.href === 'https://oauth2.googleapis.com/token') {
      const parameters = new URLSearchParams(String(init?.body));
      if (parameters.get('grant_type') === 'refresh_token') {
        state.refreshCount++;
        if (state.refreshError)
          return Response.json(
            { error: state.refreshError, error_description: 'provider details must not leak' },
            { status: 400 },
          );
        return Response.json({
          access_token: state.nextAccess,
          expires_in: 3600,
          token_type: 'Bearer',
        });
      }
      return Response.json({
        access_token: 'initial-access-token',
        ...(!state.omitRefresh ? { refresh_token: 'initial-refresh-token' } : {}),
        expires_in: 3600,
        scope: state.scopes,
        token_type: 'Bearer',
      });
    }
    if (url.href === 'https://openidconnect.googleapis.com/v1/userinfo')
      return Response.json({ sub: state.subject });
    if (url.href === 'https://oauth2.googleapis.com/revoke')
      return new Response(null, { status: 200 });
    if (url.origin === 'https://www.googleapis.com') {
      if (url.pathname.endsWith('/channels')) {
        if (url.searchParams.get('mine') === 'true')
          return Response.json({ items: [{ snippet: { title: 'My YouTube account' } }] });
        const ids = url.searchParams.get('id')?.split(',') ?? [youtubeTestChannel];
        return Response.json({
          items: ids
            .filter((id) => !state.missingChannels.has(id))
            .map((id) => ({
              id,
              snippet: { title: `Channel ${id}`, description: 'Public channel description' },
              contentDetails: { relatedPlaylists: { uploads: `uploads-${id}` } },
            })),
        });
      }
      if (url.pathname.endsWith('/subscriptions'))
        return Response.json(
          state.subscriptionPages.get(url.searchParams.get('pageToken') ?? '') ?? { items: [] },
        );
      if (url.pathname.endsWith('/playlistItems') || url.pathname.endsWith('/videos'))
        return Response.json({ items: [] });
    }
    throw new Error('Unexpected fixture endpoint');
  };
  return { state, requests, fetcher };
}
export async function connectTestYouTube(userId: string, fetcher: typeof fetch) {
  const authorization = await beginYouTubeOAuth(userId);
  return completeYouTubeOAuth(
    userId,
    { state: authorization.state, cookie: authorization.state, code: 'fixture-authorization-code' },
    fetcher,
  );
}
