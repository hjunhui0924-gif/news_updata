import { AccessError, checkMutationOrigin, getViewer } from './auth';
import { ZodError } from 'zod';
import { GitHubError } from './connectors/github';

export async function api(
  request: Request,
  action: (viewer: Awaited<ReturnType<typeof getViewer>>) => Promise<unknown>,
) {
  try {
    if (request.method !== 'GET') checkMutationOrigin(request);
    const viewer = await getViewer(request.headers);
    const data = await action(viewer);
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof GitHubError)
      return Response.json(
        { error: error.message },
        { status: error.status === 401 ? 503 : error.status },
      );
    if (error instanceof AccessError)
      return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof ZodError)
      return Response.json(
        { error: error.issues[0]?.message || '输入格式不正确' },
        { status: 400 },
      );
    console.error('API request failed:', error instanceof Error ? error.name : 'UnknownError');
    return Response.json({ error: '服务暂时不可用，请稍后重试。' }, { status: 500 });
  }
}
