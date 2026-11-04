import { setTimeout as delay } from 'node:timers/promises';
export async function waitForReady(
  url: string,
  options: {
    timeoutMs?: number;
    startedAt?: number;
    fetcher?: typeof fetch;
    intervalMs?: number;
  } = {},
) {
  const deadline = Date.now() + (options.timeoutMs ?? 90000);
  const fetcher = options.fetcher ?? fetch;
  while (Date.now() < deadline) {
    try {
      const response = await fetcher(new URL('/api/health/ready', url), {
        signal: AbortSignal.timeout(Math.min(3000, Math.max(1, deadline - Date.now()))),
      });
      const state = await response.json();
      if (
        response.ok &&
        state.ready === true &&
        state.worker === 'online' &&
        Date.parse(state.workerLastSeen) >= (options.startedAt ?? 0)
      )
        return;
    } catch {
      /* The server may still be compiling or reconnecting to PostgreSQL. */
    }
    await delay(Math.min(options.intervalMs ?? 1000, Math.max(0, deadline - Date.now())));
  }
  throw new Error('Web、数据库迁移或 Worker 未在等待时间内就绪，请检查服务后重试。');
}
