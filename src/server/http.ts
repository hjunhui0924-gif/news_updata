import { AccessError, checkMutationOrigin, getViewer } from './auth';
import { ZodError } from 'zod';
import { PlatformError } from './platforms/contract';
import { checkRequestLimit, RequestLimitError } from './request-limits';

export async function api(
  request: Request,
  action: (viewer: Awaited<ReturnType<typeof getViewer>>) => Promise<unknown>,
) {
  try {
    if (request.method !== 'GET') checkMutationOrigin(request);
    const viewer = await getViewer(request.headers);
    await checkRequestLimit(viewer.id, request);
    const data = await action(viewer);
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const headers = { 'Cache-Control': 'no-store' };
    if (error instanceof RequestLimitError)
      return Response.json(
        { error: error.message },
        {
          status: 429,
          headers: { ...headers, 'Retry-After': String(error.retryAfter) },
        },
      );
    if (error instanceof SyntaxError)
      return Response.json({ error: '请求内容无法读取，请重试。' }, { status: 400, headers });
    if (error instanceof PlatformError)
      return Response.json(
        { error: error.message },
        {
          status: error.status === 401 ? 503 : error.status,
          headers:
            error.status === 429
              ? { ...headers, 'Retry-After': String(Math.max(1, Math.ceil(error.retryAfter))) }
              : headers,
        },
      );
    if (error instanceof AccessError)
      return Response.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof ZodError)
      return Response.json(
        { error: error.issues[0]?.message || '输入格式不正确' },
        { status: 400, headers },
      );
    console.error('API request failed:', error instanceof Error ? error.name : 'UnknownError');
    return Response.json({ error: '服务暂时不可用，请稍后重试。' }, { status: 500, headers });
  }
}
