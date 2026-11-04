import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { getConfig } from '../config';
import { getPool, transaction } from '../db/client';
import { PlatformError } from './contract';
import { createYouTubeTransport } from './youtube';
import { persistentYouTubeQuota } from './youtube-quota';
import type { YouTubeConnectionStatus } from '@/shared/types';
import type { YouTubeOAuthStage, YouTubeOAuthRecovery } from '@/shared/youtube-oauth';

export const YOUTUBE_READ_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
export const YOUTUBE_OAUTH_COOKIE = 'news_youtube_oauth';
const query = "SELECT * FROM platform_connections WHERE user_id=$1 AND platform='youtube'";
const lock = (userId: string) => `platform-auth:youtube:${userId}`;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const clientFingerprint = () => {
  const config = getConfig();
  return digest(`${config.YOUTUBE_CLIENT_ID}\0${config.YOUTUBE_CLIENT_SECRET}`);
};
export const youtubeRedirectUri = () =>
  new URL('/api/platforms/youtube/callback', getConfig().APP_URL).toString();
const configured = () => {
  const config = getConfig();
  return (
    !!config.YOUTUBE_CLIENT_ID &&
    !!config.YOUTUBE_CLIENT_SECRET &&
    config.BETTER_AUTH_SECRET.length >= 32
  );
};
type Connection = {
  user_id: string;
  external_id: string | null;
  name: string | null;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: Date | null;
  refresh_expires_at: Date | null;
  scope: string | null;
  client_fingerprint: string | null;
  generation: string;
  oauth_nonce: string | null;
  state: 'connected' | 'disconnected' | 'temporary_error' | 'reconnect_required';
  retry_at: Date | null;
};
const messages: Record<YouTubeConnectionStatus['state'], string> = {
  unconfigured: '请先在服务端配置 YouTube OAuth 客户端和回调地址，再连接自己的账号。',
  disconnected: '尚未连接 YouTube。登录授权后可以读取自己的关注频道。',
  connected: 'YouTube 已连接，可读取自己的关注；后台访问凭据将按需续期。',
  refresh_pending: 'YouTube 访问凭据即将到期，下次读取或同步时自动续期。',
  reconnect_required: 'YouTube 授权已失效或配置已变化，请重新连接。订阅和阅读记录仍保留。',
  temporary_error: 'YouTube 连接暂时失败，稍后可重试；已有内容仍可阅读。',
};
export class YouTubeAuthError extends PlatformError {
  constructor(
    public state: 'reconnect_required' | 'temporary_error' | 'unconfigured',
    message = messages[state],
  ) {
    super(message, 503);
  }
}
export class YouTubeOAuthCancelled extends PlatformError {
  constructor() {
    super('你已取消 YouTube 授权，可以重新连接。', 400);
  }
}
export class YouTubeOAuthFailure extends PlatformError {
  constructor(
    public stage: YouTubeOAuthStage,
    public recovery: YouTubeOAuthRecovery,
    message: string,
    status: number,
  ) {
    super(message, status);
  }
}
const expired = (date: Date | null, margin = 0) => !date || date.getTime() <= Date.now() + margin;
const granted = (scope: string | null) => !!scope?.split(/\s+/).includes(YOUTUBE_READ_SCOPE);
async function encrypt(value: string) {
  return symmetricEncrypt({ key: getConfig().BETTER_AUTH_SECRET, data: value });
}
async function decrypt(value: string) {
  return symmetricDecrypt({ key: getConfig().BETTER_AUTH_SECRET, data: value });
}
async function connectionLock(client: PoolClient, userId: string) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lock(userId)]);
}

export async function getYouTubeAuthStatus(userId: string): Promise<YouTubeConnectionStatus> {
  const account = (await getPool().query<Connection>(query, [userId])).rows[0];
  let state: YouTubeConnectionStatus['state'];
  if (!configured()) state = 'unconfigured';
  else if (!account || account.state === 'disconnected') state = 'disconnected';
  else if (
    !account.access_token ||
    !granted(account.scope) ||
    account.client_fingerprint !== clientFingerprint()
  )
    state = 'reconnect_required';
  else if (account.state === 'reconnect_required') state = account.state;
  else if (account.retry_at && account.retry_at.getTime() > Date.now()) state = 'temporary_error';
  else if (expired(account.expires_at, 60000))
    state =
      account.refresh_token && (!account.refresh_expires_at || !expired(account.refresh_expires_at))
        ? 'refresh_pending'
        : 'reconnect_required';
  else state = 'connected';
  return {
    configured: configured(),
    state,
    name: account?.name ?? null,
    message: messages[state],
    expiresAt: account?.expires_at?.toISOString() ?? null,
    retryAt: state === 'temporary_error' ? (account?.retry_at?.toISOString() ?? null) : null,
  };
}

export async function beginYouTubeOAuth(userId: string) {
  if (!configured()) throw new YouTubeAuthError('unconfigured');
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const nonce = randomUUID();
  await transaction(async (client) => {
    await connectionLock(client, userId);
    await client.query(
      "INSERT INTO platform_connections(user_id,platform,generation,oauth_nonce) VALUES($1,'youtube',$2,$3) ON CONFLICT(user_id,platform) DO UPDATE SET oauth_nonce=excluded.oauth_nonce,updated_at=now()",
      [userId, randomUUID(), nonce],
    );
    await client.query(
      "DELETE FROM system_state WHERE key LIKE 'youtube-oauth:%' AND (value->>'userId'=$1 OR (value->>'expiresAt')::bigint<$2)",
      [userId, Date.now()],
    );
    await client.query('INSERT INTO system_state(key,value) VALUES($1,$2)', [
      `youtube-oauth:${digest(state)}`,
      { userId, nonce, verifier: await encrypt(verifier), expiresAt: Date.now() + 600000 },
    ]);
  });
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  for (const [key, value] of Object.entries({
    client_id: getConfig().YOUTUBE_CLIENT_ID,
    redirect_uri: youtubeRedirectUri(),
    response_type: 'code',
    scope: `openid ${YOUTUBE_READ_SCOPE}`,
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }))
    url.searchParams.set(key, value);
  return { url: url.toString(), state };
}

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive().max(31536000),
  scope: z.string().optional(),
  refresh_token_expires_in: z.number().int().positive().max(31536000).optional(),
  token_type: z.enum(['Bearer', 'bearer']).optional(),
});
async function tokens(
  parameters: Record<string, string>,
  fetcher: typeof fetch,
  signal?: AbortSignal,
) {
  try {
    const config = getConfig();
    const response = await fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.YOUTUBE_CLIENT_ID,
        client_secret: config.YOUTUBE_CLIENT_SECRET,
        ...parameters,
      }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const error = z.object({ error: z.string() }).safeParse(body);
      throw new YouTubeAuthError(
        error.success && error.data.error === 'invalid_grant'
          ? 'reconnect_required'
          : 'temporary_error',
      );
    }
    const parsed = tokenSchema.safeParse(body);
    if (!parsed.success) throw new YouTubeAuthError('temporary_error');
    return parsed.data;
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof YouTubeAuthError) throw error;
    throw new YouTubeAuthError('temporary_error');
  }
}

export async function completeYouTubeOAuth(
  userId: string,
  input: { state: string; cookie: string; code?: string | null; error?: string | null },
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  const progress: { stage: YouTubeOAuthStage } = { stage: 'state' };
  try {
    return await completeYouTubeOAuthRequest(userId, input, fetcher, signal, (next) => {
      progress.stage = next;
    });
  } catch (error) {
    if (error instanceof YouTubeOAuthCancelled) throw error;
    if (error instanceof YouTubeOAuthFailure) throw error;
    const stage = progress.stage;
    const recovery: YouTubeOAuthRecovery =
      error instanceof YouTubeAuthError
        ? error.state === 'unconfigured'
          ? 'configuration'
          : error.state === 'reconnect_required'
            ? 'reconnect'
            : 'temporary'
        : stage === 'state' && error instanceof PlatformError && error.status === 400
          ? 'state'
          : stage === 'scope'
            ? 'permission'
            : 'temporary';
    throw new YouTubeOAuthFailure(
      stage,
      recovery,
      error instanceof PlatformError ? error.message : 'YouTube 暂时无法完成授权，请稍后重试。',
      error instanceof PlatformError ? error.status : 503,
    );
  }
}

async function completeYouTubeOAuthRequest(
  userId: string,
  input: { state: string; cookie: string; code?: string | null; error?: string | null },
  fetcher: typeof fetch,
  signal: AbortSignal | undefined,
  setStage: (stage: YouTubeOAuthStage) => void,
) {
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(input.state) ||
    !/^[A-Za-z0-9_-]{43}$/.test(input.cookie) ||
    input.state.length !== input.cookie.length ||
    !timingSafeEqual(Buffer.from(input.state), Buffer.from(input.cookie))
  )
    throw new PlatformError('YouTube 授权状态无效，请重新连接。', 400);
  const consumed = await getPool().query(
    "DELETE FROM system_state WHERE key=$1 AND value->>'userId'=$2 RETURNING value",
    [`youtube-oauth:${digest(input.state)}`, userId],
  );
  const pending = z
    .object({ userId: z.string(), nonce: z.uuid(), verifier: z.string(), expiresAt: z.number() })
    .safeParse(consumed.rows[0]?.value);
  if (!pending.success || pending.data.expiresAt <= Date.now())
    throw new PlatformError('YouTube 授权已过期，请重新连接。', 400);
  if (input.error) throw new YouTubeOAuthCancelled();
  if (!input.code || input.code.length > 4096 || !configured())
    throw new YouTubeAuthError('unconfigured');
  const active = (await getPool().query<Connection>(query, [userId])).rows[0];
  if (active?.oauth_nonce !== pending.data.nonce)
    throw new PlatformError('此授权请求已失效，请重新连接。', 400);
  let verifier: string;
  try {
    verifier = await decrypt(pending.data.verifier);
  } catch {
    throw new YouTubeAuthError('reconnect_required');
  }
  setStage('token');
  const grant = await tokens(
    {
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: youtubeRedirectUri(),
      code_verifier: verifier,
    },
    fetcher,
    signal,
  );
  setStage('scope');
  if (!granted(grant.scope ?? null) || !grant.scope?.split(/\s+/).includes('openid'))
    throw new PlatformError('未获得读取 YouTube 关注的只读权限，请重新授权。', 400);
  let identity: { sub: string };
  let name = '我的 YouTube 账号';
  setStage('identity');
  try {
    const profile = await fetcher('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${grant.access_token}` },
      cache: 'no-store',
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    });
    if (!profile.ok) throw new Error('identity unavailable');
    identity = z.object({ sub: z.string().min(1).max(255) }).parse(await profile.json());
    setStage('channel');
    const transport = createYouTubeTransport(
      signal,
      fetcher,
      '',
      {
        token: async () => grant.access_token,
        reject: async () => {
          throw new YouTubeAuthError('reconnect_required');
        },
      },
      persistentYouTubeQuota('oauth', getConfig().YOUTUBE_CLIENT_ID),
    );
    const channels = z
      .object({ items: z.array(z.object({ snippet: z.object({ title: z.string() }) })) })
      .parse(await transport('channels', { part: 'snippet', mine: 'true' }));
    if (channels.items.length === 1) name = channels.items[0].snippet.title.slice(0, 200);
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof PlatformError) throw error;
    throw new YouTubeAuthError('temporary_error');
  }
  setStage('storage');
  await transaction(async (client) => {
    await connectionLock(client, userId);
    const current = (await client.query<Connection>(`${query} FOR UPDATE`, [userId])).rows[0];
    if (current?.oauth_nonce !== pending.data.nonce)
      throw new YouTubeOAuthFailure('storage', 'state', '此授权请求已失效，请重新连接。', 400);
    const refresh = grant.refresh_token
      ? await encrypt(grant.refresh_token)
      : current.external_id === identity.sub && current.client_fingerprint === clientFingerprint()
        ? current.refresh_token
        : null;
    if (!refresh)
      throw new YouTubeOAuthFailure(
        'storage',
        'reconnect',
        '未取得后台读取所需的长期授权，请重新连接并同意离线访问。',
        400,
      );
    await client.query(
      "UPDATE platform_connections SET external_id=$2,name=$3,access_token=$4,refresh_token=$5,expires_at=$6,refresh_expires_at=$7,scope=$8,client_fingerprint=$9,generation=$10,oauth_nonce=NULL,state='connected',retry_at=NULL,updated_at=now() WHERE user_id=$1 AND platform='youtube'",
      [
        userId,
        identity.sub,
        name,
        await encrypt(grant.access_token),
        refresh,
        new Date(Date.now() + grant.expires_in * 1000),
        grant.refresh_token_expires_in
          ? new Date(Date.now() + grant.refresh_token_expires_in * 1000)
          : grant.refresh_token
            ? null
            : current.refresh_expires_at,
        grant.scope,
        clientFingerprint(),
        pending.data.nonce,
      ],
    );
  });
  return getYouTubeAuthStatus(userId);
}

export async function youtubeAccessToken(
  userId: string,
  options: { rejectedToken?: string; fetcher?: typeof fetch; signal?: AbortSignal } = {},
) {
  if (!configured()) throw new YouTubeAuthError('unconfigured');
  const result = await transaction(
    async (client): Promise<{ token: string } | { error: YouTubeAuthError }> => {
      await connectionLock(client, userId);
      options.signal?.throwIfAborted();
      const account = (await client.query<Connection>(`${query} FOR UPDATE`, [userId])).rows[0];
      if (!account || account.state === 'disconnected')
        return { error: new YouTubeAuthError('reconnect_required', messages.disconnected) };
      const fail = async (state: 'temporary_error' | 'reconnect_required') => {
        await client.query(
          "UPDATE platform_connections SET state=$2,retry_at=$3,updated_at=now() WHERE user_id=$1 AND platform='youtube'",
          [userId, state, state === 'temporary_error' ? new Date(Date.now() + 60000) : null],
        );
        return { error: new YouTubeAuthError(state) };
      };
      if (
        !account.access_token ||
        !granted(account.scope) ||
        account.client_fingerprint !== clientFingerprint()
      )
        return fail('reconnect_required');
      if (account.state === 'reconnect_required')
        return { error: new YouTubeAuthError('reconnect_required') };
      if (account.retry_at && account.retry_at.getTime() > Date.now())
        return { error: new YouTubeAuthError('temporary_error') };
      let access: string;
      try {
        access = await decrypt(account.access_token);
      } catch {
        return fail('reconnect_required');
      }
      if (options.rejectedToken !== access && !expired(account.expires_at, 60000))
        return { token: access };
      if (
        !account.refresh_token ||
        (account.refresh_expires_at && expired(account.refresh_expires_at))
      )
        return fail('reconnect_required');
      let refresh: string;
      try {
        refresh = await decrypt(account.refresh_token);
      } catch {
        return fail('reconnect_required');
      }
      try {
        const grant = await tokens(
          { grant_type: 'refresh_token', refresh_token: refresh },
          options.fetcher ?? fetch,
        );
        const scope = grant.scope ?? account.scope;
        if (!granted(scope)) return fail('reconnect_required');
        // Persist an exchanged token even if the caller just cancelled, avoiding a lost rotation.
        await client.query(
          "UPDATE platform_connections SET access_token=$2,refresh_token=$3,expires_at=$4,refresh_expires_at=$5,scope=$6,state='connected',retry_at=NULL,updated_at=now() WHERE user_id=$1 AND platform='youtube'",
          [
            userId,
            await encrypt(grant.access_token),
            grant.refresh_token ? await encrypt(grant.refresh_token) : account.refresh_token,
            new Date(Date.now() + grant.expires_in * 1000),
            grant.refresh_token_expires_in
              ? new Date(Date.now() + grant.refresh_token_expires_in * 1000)
              : account.refresh_expires_at,
            scope,
          ],
        );
        return { token: grant.access_token };
      } catch (error) {
        return fail(
          error instanceof YouTubeAuthError
            ? error.state === 'reconnect_required'
              ? 'reconnect_required'
              : 'temporary_error'
            : 'temporary_error',
        );
      }
    },
  );
  options.signal?.throwIfAborted();
  if ('error' in result) throw result.error;
  return result.token;
}

async function rejectToken(userId: string, token: string) {
  await transaction(async (client) => {
    await connectionLock(client, userId);
    const account = (await client.query<Connection>(`${query} FOR UPDATE`, [userId])).rows[0];
    if (account?.access_token && (await decrypt(account.access_token).catch(() => '')) === token)
      await client.query(
        "UPDATE platform_connections SET state='reconnect_required',retry_at=NULL WHERE user_id=$1 AND platform='youtube'",
        [userId],
      );
  });
}
export async function createUserYouTubeTransport(
  userId: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  const exists = (
    await getPool().query('SELECT 1 FROM platform_connections WHERE user_id=$1 AND platform=$2', [
      userId,
      'youtube',
    ])
  ).rowCount;
  if (!exists)
    return createYouTubeTransport(
      signal,
      fetcher,
      getConfig().YOUTUBE_API_KEY,
      undefined,
      persistentYouTubeQuota('key', getConfig().YOUTUBE_API_KEY),
    );
  return createYouTubeTransport(
    signal,
    fetcher,
    '',
    {
      token: (rejectedToken) => youtubeAccessToken(userId, { signal, fetcher, rejectedToken }),
      reject: (token) => rejectToken(userId, token),
    },
    persistentYouTubeQuota('oauth', getConfig().YOUTUBE_CLIENT_ID),
  );
}
export async function youtubeConnectionGeneration(userId: string) {
  const status = await getYouTubeAuthStatus(userId);
  if (!['connected', 'refresh_pending'].includes(status.state))
    throw new YouTubeAuthError(
      status.state === 'unconfigured'
        ? 'unconfigured'
        : status.state === 'temporary_error'
          ? 'temporary_error'
          : 'reconnect_required',
      status.message,
    );
  return (await getPool().query<Connection>(query, [userId])).rows[0].generation;
}

export async function disconnectYouTube(userId: string, fetcher: typeof fetch = fetch) {
  const revoked = await transaction(async (client) => {
    await connectionLock(client, userId);
    const account = (await client.query<Connection>(`${query} FOR UPDATE`, [userId])).rows[0];
    const previous = account?.refresh_token ?? account?.access_token;
    const token = previous ? await decrypt(previous).catch(() => null) : null;
    let revoked = !token;
    // Keep revocation inside the account lock so a reconnect cannot race an old logout.
    if (token)
      try {
        const response = await fetcher('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token }),
          signal: AbortSignal.timeout(8000),
          redirect: 'error',
          cache: 'no-store',
        });
        revoked = response.ok;
      } catch {
        /* Remove local credentials even when Google cannot be reached. */
      }
    await client.query(
      "INSERT INTO platform_connections(user_id,platform,generation) VALUES($1,'youtube',$2) ON CONFLICT(user_id,platform) DO UPDATE SET external_id=NULL,name=NULL,access_token=NULL,refresh_token=NULL,expires_at=NULL,refresh_expires_at=NULL,scope=NULL,client_fingerprint=NULL,generation=excluded.generation,oauth_nonce=NULL,state='disconnected',retry_at=NULL,updated_at=now()",
      [userId, randomUUID()],
    );
    await client.query(
      "DELETE FROM system_state WHERE (key LIKE 'youtube-oauth:%' AND value->>'userId'=$1) OR key LIKE $2",
      [userId, `youtube-follow-preview:${userId}:%`],
    );
    return revoked;
  });
  return { connection: await getYouTubeAuthStatus(userId), revoked };
}
