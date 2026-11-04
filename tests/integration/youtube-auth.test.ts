import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { symmetricDecrypt } from 'better-auth/crypto';
import { migrate } from '../../scripts/migrate';
import { getPool } from '../../src/server/db/client';
import {
  beginYouTubeOAuth,
  completeYouTubeOAuth,
  createUserYouTubeTransport,
  disconnectYouTube,
  getYouTubeAuthStatus,
  youtubeAccessToken,
  YOUTUBE_READ_SCOPE,
  YouTubeOAuthFailure,
} from '../../src/server/platforms/youtube-auth';
import { connectTestYouTube, googleFixture } from '../helpers/youtube-oauth';

const secret = 'youtube-test-secret-at-least-thirty-two-characters';
let user: string;
let fixture: ReturnType<typeof googleFixture>;
const row = async () =>
  (
    await getPool().query(
      "SELECT * FROM platform_connections WHERE user_id=$1 AND platform='youtube'",
      [user],
    )
  ).rows[0];
beforeAll(async () => {
  await migrate();
});
beforeEach(async () => {
  vi.stubEnv('APP_MODE', 'demo');
  vi.stubEnv('YOUTUBE_CLIENT_ID', 'youtube-test-client');
  vi.stubEnv('YOUTUBE_CLIENT_SECRET', 'youtube-test-client-secret');
  vi.stubEnv('BETTER_AUTH_SECRET', secret);
  vi.stubEnv('YOUTUBE_API_KEY', '');
  user = `youtube-auth-${randomUUID()}`;
  fixture = googleFixture();
  await getPool().query('INSERT INTO app_users(id,name) VALUES($1,$1)', [user]);
});
afterEach(async () => {
  await getPool().query('DELETE FROM platform_connections WHERE user_id=$1', [user]);
  await getPool().query("DELETE FROM system_state WHERE value->>'userId'=$1", [user]);
  await getPool().query('DELETE FROM app_users WHERE id=$1', [user]);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await getPool().end();
});

it('requests only identity and read-only YouTube scope with offline access, PKCE and user-bound one-use state', async () => {
  const authorization = await beginYouTubeOAuth(user);
  const url = new URL(authorization.url);
  expect(url.origin).toBe('https://accounts.google.com');
  expect(url.searchParams.get('scope')).toBe(`openid ${YOUTUBE_READ_SCOPE}`);
  expect(url.searchParams.get('access_type')).toBe('offline');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  const key = `youtube-oauth:${createHash('sha256').update(authorization.state).digest('hex')}`;
  const pending = (await getPool().query('SELECT value FROM system_state WHERE key=$1', [key]))
    .rows[0].value;
  expect(pending.verifier).not.toBe(url.searchParams.get('code_challenge'));
  const verifier = await symmetricDecrypt({ key: secret, data: pending.verifier });
  expect(createHash('sha256').update(verifier).digest('base64url')).toBe(
    url.searchParams.get('code_challenge'),
  );
  await expect(
    completeYouTubeOAuth(
      'another-user',
      { state: authorization.state, cookie: authorization.state, code: 'code' },
      fixture.fetcher,
    ),
  ).rejects.toThrow('过期');
  await expect(
    completeYouTubeOAuth(
      user,
      { state: authorization.state, cookie: 'x'.repeat(43), code: 'code' },
      fixture.fetcher,
    ),
  ).rejects.toThrow('状态无效');
  expect(fixture.requests).toHaveLength(0);
  await completeYouTubeOAuth(
    user,
    { state: authorization.state, cookie: authorization.state, code: 'code' },
    fixture.fetcher,
  );
  await expect(
    completeYouTubeOAuth(
      user,
      { state: authorization.state, cookie: authorization.state, code: 'code' },
      fixture.fetcher,
    ),
  ).rejects.toThrow('过期');
});

it('encrypts both credentials, returns no tokens and identifies the Google account without email permission', async () => {
  const status = await connectTestYouTube(user, fixture.fetcher);
  expect(status).toMatchObject({
    state: 'connected',
    name: 'My YouTube account',
    configured: true,
  });
  const stored = await row();
  expect(stored.external_id).toBe('google-test-subject');
  expect(stored.access_token).not.toContain('initial-access-token');
  expect(stored.refresh_token).not.toContain('initial-refresh-token');
  expect(await symmetricDecrypt({ key: secret, data: stored.refresh_token })).toBe(
    'initial-refresh-token',
  );
  expect(JSON.stringify(status)).not.toMatch(
    /initial-access-token|initial-refresh-token|google-test-subject|access_token|refresh_token/,
  );
  const profile = fixture.requests.find((request) => request.url.pathname.endsWith('/userinfo'))!;
  expect(new Headers(profile.init?.headers).get('Authorization')).toBe(
    'Bearer initial-access-token',
  );
  const tokenRequest = fixture.requests.find((request) => request.url.pathname.endsWith('/token'))!;
  const parameters = new URLSearchParams(String(tokenRequest.init?.body));
  expect(parameters.get('redirect_uri')).toContain('/api/platforms/youtube/callback');
  expect(parameters.get('code_verifier')).toBeTruthy();
});

it('identifies the failing OAuth step without retaining provider secrets in diagnostics', async () => {
  const failedToken: typeof fetch = async () => {
    throw new Error('private-provider-token');
  };
  const error = await connectTestYouTube(user, failedToken).catch((failure: unknown) => failure);
  expect(error).toBeInstanceOf(YouTubeOAuthFailure);
  expect(error).toMatchObject({ stage: 'token', recovery: 'temporary' });
  expect(JSON.stringify(error)).not.toContain('private-provider-token');
  for (const [path, stage] of [
    ['/userinfo', 'identity'],
    ['/channels', 'channel'],
  ] as const) {
    const fetcher: typeof fetch = async (input, init) =>
      String(input).split('?')[0].endsWith(path)
        ? Response.json({ error: 'private-provider-body' }, { status: 503 })
        : fixture.fetcher(input, init);
    const failure = await connectTestYouTube(user, fetcher).catch((failure: unknown) => failure);
    expect(failure).toMatchObject({ stage, recovery: 'temporary' });
    expect(JSON.stringify(failure)).not.toContain('private-provider-body');
  }
});

it('rejects missing read scope, absent refresh access, expired and cancelled authorization without storing tokens', async () => {
  fixture.state.scopes = 'openid';
  await expect(connectTestYouTube(user, fixture.fetcher)).rejects.toThrow('只读权限');
  expect((await row()).access_token).toBeNull();
  fixture.state.scopes = `openid ${YOUTUBE_READ_SCOPE}`;
  fixture.state.omitRefresh = true;
  await expect(connectTestYouTube(user, fixture.fetcher)).rejects.toThrow('长期授权');
  await expect(connectTestYouTube(user, fixture.fetcher)).rejects.toMatchObject({
    stage: 'storage',
    recovery: 'reconnect',
  });
  const expired = await beginYouTubeOAuth(user);
  await getPool().query(
    "UPDATE system_state SET value=jsonb_set(value,'{expiresAt}','0'::jsonb) WHERE value->>'userId'=$1",
    [user],
  );
  await expect(
    completeYouTubeOAuth(
      user,
      { state: expired.state, cookie: expired.state, code: 'code' },
      fixture.fetcher,
    ),
  ).rejects.toThrow('过期');
  const cancelled = await beginYouTubeOAuth(user);
  await expect(
    completeYouTubeOAuth(
      user,
      { state: cancelled.state, cookie: cancelled.state, error: 'access_denied' },
      fixture.fetcher,
    ),
  ).rejects.toThrow('取消');
  expect((await row()).access_token).toBeNull();
});

it('invalidates authorization that loses its connection generation before saving', async () => {
  const fetcher: typeof fetch = async (input, init) => {
    const response = await fixture.fetcher(input, init);
    if (String(input).includes('/channels?'))
      await getPool().query(
        "UPDATE platform_connections SET oauth_nonce=$2 WHERE user_id=$1 AND platform='youtube'",
        [user, randomUUID()],
      );
    return response;
  };
  await expect(connectTestYouTube(user, fetcher)).rejects.toMatchObject({
    stage: 'storage',
    recovery: 'state',
  });
  expect((await row()).access_token).toBeNull();
});

it('serializes concurrent refreshes and ignores a late rejection of an already-replaced token', async () => {
  await connectTestYouTube(user, fixture.fetcher);
  await getPool().query(
    "UPDATE platform_connections SET expires_at=now()-interval '1 minute' WHERE user_id=$1",
    [user],
  );
  expect((await getYouTubeAuthStatus(user)).state).toBe('refresh_pending');
  const tokens = await Promise.all([
    youtubeAccessToken(user, { fetcher: fixture.fetcher }),
    youtubeAccessToken(user, { fetcher: fixture.fetcher }),
  ]);
  expect(tokens).toEqual(['refreshed-access-token', 'refreshed-access-token']);
  expect(fixture.state.refreshCount).toBe(1);
  expect(
    await youtubeAccessToken(user, {
      fetcher: fixture.fetcher,
      rejectedToken: 'initial-access-token',
    }),
  ).toBe('refreshed-access-token');
  expect(fixture.state.refreshCount).toBe(1);
});

it('persists temporary backoff without leaking provider details and requires reconnect for revoked grants', async () => {
  await connectTestYouTube(user, fixture.fetcher);
  await getPool().query(
    "UPDATE platform_connections SET expires_at=now()-interval '1 minute' WHERE user_id=$1",
    [user],
  );
  fixture.state.refreshError = 'temporarily_unavailable';
  await expect(youtubeAccessToken(user, { fetcher: fixture.fetcher })).rejects.toThrow('暂时失败');
  await expect(youtubeAccessToken(user, { fetcher: fixture.fetcher })).rejects.toThrow('暂时失败');
  expect(fixture.state.refreshCount).toBe(1);
  expect((await getYouTubeAuthStatus(user)).state).toBe('temporary_error');
  await getPool().query(
    "UPDATE platform_connections SET retry_at=now()-interval '1 second' WHERE user_id=$1",
    [user],
  );
  fixture.state.refreshError = 'invalid_grant';
  await expect(youtubeAccessToken(user, { fetcher: fixture.fetcher })).rejects.toThrow('重新连接');
  expect((await getYouTubeAuthStatus(user)).state).toBe('reconnect_required');
  expect(JSON.stringify(await getYouTubeAuthStatus(user))).not.toContain('provider details');
});

it('uses bearer authorization, refreshes one 401 and never places an account token or API key in its URL', async () => {
  await connectTestYouTube(user, fixture.fetcher);
  vi.stubEnv('YOUTUBE_API_KEY', 'must-not-be-used');
  let calls = 0;
  const transport = await createUserYouTubeTransport(user, undefined, async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/subscriptions')) {
      calls++;
      expect(url.searchParams.has('key')).toBe(false);
      expect(url.searchParams.has('access_token')).toBe(false);
      expect(new Headers(init?.headers).get('Authorization')).toBe(
        calls === 1 ? 'Bearer initial-access-token' : 'Bearer refreshed-access-token',
      );
      if (calls === 1) return Response.json({ error: {} }, { status: 401 });
      return Response.json({ items: [] });
    }
    return fixture.fetcher(input, init);
  });
  expect(await transport('subscriptions', { mine: 'true', part: 'snippet' })).toEqual({
    items: [],
  });
  expect(calls).toBe(2);
  expect(fixture.state.refreshCount).toBe(1);
});

it('clears credentials on disconnect even if revocation fails and fences off old callbacks and transports', async () => {
  await connectTestYouTube(user, fixture.fetcher);
  const pending = await beginYouTubeOAuth(user);
  const transport = await createUserYouTubeTransport(user, undefined, fixture.fetcher);
  const result = await disconnectYouTube(user, async () => {
    throw new Error('network containing provider token');
  });
  expect(result).toMatchObject({
    revoked: false,
    connection: { state: 'disconnected', name: null },
  });
  expect(await row()).toMatchObject({
    access_token: null,
    refresh_token: null,
    external_id: null,
    oauth_nonce: null,
  });
  await expect(transport('subscriptions', { mine: 'true', part: 'snippet' })).rejects.toThrow(
    '尚未连接',
  );
  await expect(
    completeYouTubeOAuth(
      user,
      { state: pending.state, cookie: pending.state, code: 'old-code' },
      fixture.fetcher,
    ),
  ).rejects.toThrow('过期');
  expect((await row()).state).toBe('disconnected');
});

it('blocks obsolete clients and missing configuration without sending network requests', async () => {
  expect((await getYouTubeAuthStatus(user)).state).toBe('disconnected');
  await connectTestYouTube(user, fixture.fetcher);
  vi.stubEnv('YOUTUBE_CLIENT_SECRET', 'rotated-client-secret');
  await expect(youtubeAccessToken(user, { fetcher: fixture.fetcher })).rejects.toThrow('重新连接');
  const count = fixture.requests.length;
  vi.stubEnv('YOUTUBE_CLIENT_ID', '');
  expect((await getYouTubeAuthStatus(user)).state).toBe('unconfigured');
  await expect(beginYouTubeOAuth(user)).rejects.toThrow('OAuth');
  expect(fixture.requests).toHaveLength(count);
});

it('commits rotated refresh credentials before propagating caller cancellation', async () => {
  await connectTestYouTube(user, fixture.fetcher);
  await getPool().query(
    "UPDATE platform_connections SET expires_at=now()-interval '1 minute' WHERE user_id=$1",
    [user],
  );
  const controller = new AbortController();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let exchangeSignal: AbortSignal | null | undefined;
  const result = youtubeAccessToken(user, {
    signal: controller.signal,
    fetcher: async (_input, init) => {
      exchangeSignal = init?.signal;
      return new Response(
        new ReadableStream({
          async start(stream) {
            entered.resolve();
            await release.promise;
            stream.enqueue(
              new TextEncoder().encode(
                JSON.stringify({
                  access_token: 'rotated-access',
                  refresh_token: 'rotated-refresh',
                  expires_in: 3600,
                }),
              ),
            );
            stream.close();
          },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    },
  });
  const rejected = expect(result).rejects.toThrow('cancelled');
  await entered.promise;
  controller.abort(new Error('cancelled'));
  expect(exchangeSignal?.aborted).toBe(false);
  release.resolve();
  await rejected;
  const stored = await row();
  expect(await symmetricDecrypt({ key: secret, data: stored.refresh_token })).toBe(
    'rotated-refresh',
  );
  expect(await youtubeAccessToken(user, { fetcher: fixture.fetcher })).toBe('rotated-access');
  expect(stored.state).toBe('connected');
  expect(fixture.state.refreshCount).toBe(0);
});

it('serializes revocation and reconnect so an old logout cannot revoke the new connection', async () => {
  await connectTestYouTube(user, fixture.fetcher);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const order: string[] = [];
  const logout = disconnectYouTube(user, async () => {
    order.push('revoke-start');
    entered.resolve();
    await release.promise;
    order.push('revoke-end');
    return new Response(null, { status: 200 });
  });
  await entered.promise;
  const reconnect = beginYouTubeOAuth(user).then((value) => {
    order.push('reconnect');
    return value;
  });
  // An independent query confirms the logout still owns the row lock.
  const locked = await getPool().query(
    "SELECT granted FROM pg_locks WHERE locktype='advisory' AND granted=true",
  );
  expect(locked.rowCount).toBeGreaterThan(0);
  expect(order).toEqual(['revoke-start']);
  release.resolve();
  expect((await logout).revoked).toBe(true);
  const pending = await reconnect;
  await completeYouTubeOAuth(
    user,
    { state: pending.state, cookie: pending.state, code: 'new-code' },
    fixture.fetcher,
  );
  expect(order).toEqual(['revoke-start', 'revoke-end', 'reconnect']);
  expect((await getYouTubeAuthStatus(user)).state).toBe('connected');
});
