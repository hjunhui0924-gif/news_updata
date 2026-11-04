import { afterEach, expect, it, vi } from 'vitest';
import { requestJson } from '../src/components/request-json';

afterEach(() => vi.unstubAllGlobals());

it('preserves cancellation and classifies timeout while reading the response body', async () => {
  const abort = new AbortController();
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => {
          abort.abort();
          throw abort.signal.reason;
        },
      })
      .mockResolvedValueOnce({
        json: async () => {
          throw new DOMException('timed out', 'TimeoutError');
        },
      }),
  );
  await expect(requestJson('/api/feed', 'GET', undefined, abort.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  await expect(requestJson('/api/feed')).rejects.toThrow('请求等待超时');
});

it('explains network failures, timeouts and unreadable responses', async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError'))
    .mockResolvedValueOnce(new Response('bad json'));
  vi.stubGlobal('fetch', fetch);
  await expect(requestJson('/api/feed')).rejects.toThrow('暂时无法连接服务');
  await expect(requestJson('/api/feed')).rejects.toThrow('请求等待超时');
  await expect(requestJson('/api/feed')).rejects.toThrow('服务返回了无法读取的响应');
});

it('preserves caller cancellation and API validation messages', async () => {
  const abort = new AbortController();
  abort.abort();
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockRejectedValueOnce(abort.signal.reason)
      .mockResolvedValueOnce(Response.json({ error: '请填写有效仓库' }, { status: 400 })),
  );
  await expect(requestJson('/api/feed', 'GET', undefined, abort.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  await expect(requestJson('/api/subscriptions', 'POST', {})).rejects.toThrow('请填写有效仓库');
});
