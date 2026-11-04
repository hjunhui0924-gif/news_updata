export class RequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export async function requestJson<T>(
  url: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
    : AbortSignal.timeout(15000);
  function fail(error: unknown, fallback: string): never {
    if (signal?.aborted) throw signal.reason;
    if (
      (requestSignal.aborted && requestSignal.reason?.name === 'TimeoutError') ||
      (error instanceof Error && error.name === 'TimeoutError')
    )
      throw new Error('请求等待超时，请稍后重试。');
    throw new Error(fallback);
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: requestSignal,
    });
  } catch (error) {
    fail(error, '暂时无法连接服务，请检查连接后重试。');
  }
  let result;
  try {
    result = await response.json();
  } catch (error) {
    fail(error, '服务返回了无法读取的响应，请稍后重试。');
  }
  if (!response.ok)
    throw new RequestError(
      typeof result?.error === 'string' ? result.error : '操作未完成，请重试。',
      response.status,
    );
  return result;
}
