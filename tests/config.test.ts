import { describe, expect, it } from 'vitest';
import { getConfig, isLocalHost } from '../src/server/config';

describe('local demo boundary', () => {
  it('never bypasses authentication in production', () => {
    expect(() => getConfig({ APP_MODE: 'demo', NODE_ENV: 'production' })).toThrow('本地');
  });
  it('rejects a public demo URL and misleading host suffix', () => {
    expect(() => getConfig({ APP_MODE: 'demo', APP_URL: 'https://news.example.com' })).toThrow();
    expect(isLocalHost('localhost.evil.com')).toBe(false);
    expect(isLocalHost('127.0.0.1:3000')).toBe(true);
  });
  it('does not enable billable AI without credentials and pricing', () => {
    expect(() => getConfig({ LLM_ENABLED: 'true' })).toThrow('实际 token 单价');
    expect(getConfig({}).LLM_ENABLED).toBe('false');
  });
  it('rejects the example login secret in production', () => {
    expect(() =>
      getConfig({
        APP_MODE: 'live',
        NODE_ENV: 'production',
        BETTER_AUTH_SECRET: 'replace-with-a-random-secret-at-least-32-characters',
        ALLOWED_GITHUB_USER_IDS: '1',
      }),
    ).toThrow('登录密钥');
  });
});
