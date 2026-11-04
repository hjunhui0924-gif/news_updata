import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AccessError, getViewer } from '../src/server/auth';
import { completeYouTubeOAuth, YouTubeOAuthFailure } from '../src/server/platforms/youtube-auth';
import { GET } from '../src/app/api/platforms/youtube/callback/route';
import { supportsSourceKind } from '../src/shared/platforms';

vi.mock('../src/server/auth', async () => ({
  ...(await import('../src/server/auth/errors')),
  getViewer: vi.fn(),
}));
vi.mock('../src/server/platforms/youtube-auth', async (original) => ({
  ...(await original<typeof import('../src/server/platforms/youtube-auth')>()),
  completeYouTubeOAuth: vi.fn(),
}));
beforeEach(() => {
  vi.stubEnv('APP_MODE', 'demo');
  vi.stubEnv('APP_URL', 'http://127.0.0.1:3000');
  vi.mocked(getViewer).mockResolvedValue({ id: 'fixture', name: 'Demo', image: null });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it('returns only allowlisted recovery information and logs no provider or request secrets', async () => {
  vi.mocked(completeYouTubeOAuth).mockRejectedValue(
    new YouTubeOAuthFailure('identity', 'temporary', 'private-provider-message', 503),
  );
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const response = await GET(
    new NextRequest(
      'http://127.0.0.1:3000/api/platforms/youtube/callback?code=private-code&state=private-state&returnTo=https://foreign.test',
      { headers: { cookie: 'news_youtube_oauth=private-cookie' } },
    ),
  );
  const target = new URL(response.headers.get('location')!);
  expect(target.origin).toBe('http://127.0.0.1:3000');
  expect(target.searchParams.get('youtubeReason')).toBe('temporary');
  expect(target.searchParams.get('youtubeDiagnostic')).toMatch(/^[0-9a-f-]{36}$/);
  expect(JSON.stringify(warn.mock.calls) + target.href).not.toMatch(/private-|foreign/);
  expect(warn.mock.calls[0][1]).toMatchObject({
    stage: 'identity',
    reason: 'temporary',
    status: 503,
  });
  expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
});

it('distinguishes a lost website session before attempting a platform exchange', async () => {
  vi.mocked(getViewer).mockRejectedValue(new AccessError('private-session'));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const response = await GET(
    new NextRequest('http://127.0.0.1:3000/api/platforms/youtube/callback'),
  );
  expect(new URL(response.headers.get('location')!).searchParams.get('youtubeReason')).toBe(
    'session',
  );
  expect(warn.mock.calls[0][1]).toMatchObject({ stage: 'session' });
});

it('rejects unsupported source kinds without falling back to another platform', () => {
  expect(supportsSourceKind('youtube', 'repo')).toBe(false);
  expect(supportsSourceKind('github', 'channel')).toBe(false);
  expect(supportsSourceKind('youtube', 'channel')).toBe(true);
});

it('preserves explicit reconnect and invalid-state actions from credential storage', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  for (const recovery of ['reconnect', 'state'] as const) {
    vi.mocked(completeYouTubeOAuth).mockRejectedValue(
      new YouTubeOAuthFailure('storage', recovery, 'safe message', 400),
    );
    const response = await GET(
      new NextRequest('http://127.0.0.1:3000/api/platforms/youtube/callback'),
    );
    expect(new URL(response.headers.get('location')!).searchParams.get('youtubeReason')).toBe(
      recovery,
    );
  }
});
