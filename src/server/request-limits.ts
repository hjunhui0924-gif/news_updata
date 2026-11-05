import { getConfig } from './config';
import { getPool } from './db/client';

type Scope = 'read' | 'write' | 'external' | 'ai';
export class RequestLimitError extends Error {
  constructor(public retryAfter: number) {
    super('操作较频繁，请稍后重试。已有内容仍可阅读。');
  }
}

export function requestLimitScope(request: Request): Scope {
  const path = new URL(request.url).pathname;
  if (
    (request.method === 'POST' && path === '/api/subscriptions') ||
    (request.method === 'DELETE' && path === '/api/platforms/youtube/connection')
  )
    return 'external';
  if (request.method !== 'GET' && /\/translation$|\/summary\/retry$|\/skills\/ai$/.test(path))
    return 'ai';
  if (
    /^\/api\/(github\/(following|starred|repositories|connection)|platforms\/youtube\/(following|connect)|skills\/(starred|detail)|trending(?:$|\/))/.test(
      path,
    )
  )
    return 'external';
  return request.method === 'GET' ? 'read' : 'write';
}

export async function checkRequestLimit(userId: string, request: Request) {
  const config = getConfig();
  if (config.APP_MODE === 'demo') return;
  const scope = requestLimitScope(request);
  const limit = {
    read: config.API_READ_LIMIT_PER_MINUTE,
    write: config.API_WRITE_LIMIT_PER_MINUTE,
    external: config.API_EXTERNAL_LIMIT_PER_MINUTE,
    ai: config.API_AI_LIMIT_PER_MINUTE,
  }[scope];
  // A single atomic UPSERT keeps the limit shared across tabs, requests and Web processes.
  const accepted = await getPool().query(
    `INSERT INTO request_limits(user_id,scope,used,reset_at) VALUES($1,$2,1,now()+interval '1 minute')
     ON CONFLICT(user_id,scope) DO UPDATE SET
       used=CASE WHEN request_limits.reset_at<=now() THEN 1 ELSE request_limits.used+1 END,
       reset_at=CASE WHEN request_limits.reset_at<=now() THEN excluded.reset_at ELSE request_limits.reset_at END
     WHERE request_limits.reset_at<=now() OR request_limits.used<$3 RETURNING reset_at`,
    [userId, scope, limit],
  );
  if (accepted.rowCount) return;
  const result = await getPool().query(
    'SELECT greatest(1,ceil(extract(epoch FROM reset_at-now())))::int AS retry_after FROM request_limits WHERE user_id=$1 AND scope=$2',
    [userId, scope],
  );
  throw new RequestLimitError(Number(result.rows[0]?.retry_after ?? 60));
}
