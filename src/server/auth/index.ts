import { betterAuth } from 'better-auth';
import { headers } from 'next/headers';
import { getConfig, isLocalHost } from '../config';
import { getPool } from '../db/client';

export class AccessError extends Error {
  constructor(
    message: string,
    public status = 401,
  ) {
    super(message);
  }
}
function createAuth() {
  const config = getConfig();
  const allowed = config.ALLOWED_GITHUB_USER_IDS.split(',').map((x) => x.trim());
  return betterAuth({
    database: getPool(),
    baseURL: config.APP_URL,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [config.APP_URL],
    // All token rotation goes through our cross-process lock; these unused routes
    // otherwise rotate independently and can return provider tokens to clients.
    disabledPaths: ['/get-access-token', '/refresh-token', '/account-info'],
    account: { encryptOAuthTokens: true, accountLinking: { enabled: false } },
    socialProviders: {
      github: {
        clientId: config.GITHUB_CLIENT_ID,
        clientSecret: config.GITHUB_CLIENT_SECRET,
        mapProfileToUser: (profile) => {
          if (!allowed.includes(String(profile.id)))
            throw new AccessError('此账号尚未获得访问权限', 403);
          return { name: profile.name || profile.login };
        },
      },
    },
  });
}
let auth: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  return (auth ??= createAuth());
}

export async function getViewer(requestHeaders?: Headers) {
  const h = requestHeaders ?? (await headers());
  const config = getConfig();
  if (config.APP_MODE === 'demo') {
    if (!isLocalHost(h.get('host') || '')) throw new AccessError('演示模式仅允许本地访问', 403);
    return { id: 'demo', name: '我的工作空间', image: null };
  }
  if (!config.GITHUB_CLIENT_ID || !config.GITHUB_CLIENT_SECRET)
    throw new AccessError('请先配置 GitHub 登录', 503);
  const session = await getAuth().api.getSession({ headers: h });
  if (!session) throw new AccessError('请先登录');
  const account = await getPool().query(
    'SELECT "accountId" FROM account WHERE "userId"=$1 AND "providerId"=$2',
    [session.user.id, 'github'],
  );
  const allowed = config.ALLOWED_GITHUB_USER_IDS.split(',').map((x) => x.trim());
  if (!account.rows.some((row) => allowed.includes(row.accountId)))
    throw new AccessError('此账号尚未获得访问权限', 403);
  await getPool().query(
    'INSERT INTO app_users(id,name) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET name=excluded.name',
    [session.user.id, session.user.name],
  );
  return session.user;
}

export function checkMutationOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(getConfig().APP_URL).origin)
    throw new AccessError('请求来源不受信任', 403);
}
