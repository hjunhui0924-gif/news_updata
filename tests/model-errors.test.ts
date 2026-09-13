import { afterEach, expect, it, vi } from 'vitest';
import { callModel } from '../src/server/ai/service';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it.each([
  [403, 'AllocationQuota.FreeTierOnly', '模型免费额度已耗尽'],
  [401, 'invalid_api_key', '模型服务授权失败'],
  [429, 'rate_limit', '模型服务请求受限'],
  [503, 'unknown', '模型服务返回 503'],
])('reports a safe actionable provider error for %s/%s', async (status, code, expected) => {
  vi.stubEnv('LLM_ENABLED', 'false');
  vi.stubEnv('LLM_API_BASE_URL', 'https://fixture.invalid/v1');
  vi.stubEnv('LLM_API_KEY', 'sensitive-test-key');
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { code, message: 'sensitive-test-key source text' } }),
          { status: Number(status) },
        ),
    ),
  );
  await expect(
    callModel({
      system: 'Translate to JSON.',
      user: 'Bug fixes',
      kind: 'translation',
      outputLimit: 100,
    }),
  ).rejects.toThrow(String(expected));
});
it('handles non-JSON upstream failures without returning response content', async () => {
  vi.stubEnv('LLM_ENABLED', 'false');
  vi.stubEnv('LLM_API_BASE_URL', 'https://fixture.invalid/v1');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('sensitive raw upstream error', { status: 502 })),
  );
  await expect(
    callModel({
      system: 'Translate to JSON.',
      user: 'Bug fixes',
      kind: 'translation',
      outputLimit: 100,
    }),
  ).rejects.toThrow('模型服务返回 502，请检查配置或稍后重试。');
});
