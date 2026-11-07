import { describe, expect, it } from 'vitest';
import {
  getConfig,
  isLocalHost,
  localSkillsEnabled,
  parseDatabaseRuntime,
} from '../src/server/config';

describe('PostgreSQL deployment mode', () => {
  it('defaults existing installations to Docker and rejects unsupported modes', () => {
    expect(getConfig({}).DATABASE_RUNTIME).toBe('docker');
    expect(parseDatabaseRuntime(undefined)).toBe('docker');
    for (const value of ['', 'auto', 'postgres', 'Native']) {
      expect(() => getConfig({ DATABASE_RUNTIME: value })).toThrow();
      expect(() => parseDatabaseRuntime(value)).toThrow();
    }
  });
  it.each(['docker', 'native'])('uses DATABASE_URL unchanged in %s mode', (runtime) => {
    const url = 'postgresql://news:fixture-only@127.0.0.1:55432/news_native';
    const config = getConfig({ DATABASE_RUNTIME: runtime, DATABASE_URL: url });
    expect(config.DATABASE_RUNTIME).toBe(runtime);
    expect(config.DATABASE_URL).toBe(url);
    expect(localSkillsEnabled({ ...config, LOCAL_SKILLS_ENABLED: 'false' })).toBe(false);
  });
});

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
  it('requires HTTPS for a public production URL', () => {
    expect(() =>
      getConfig({
        APP_MODE: 'live',
        NODE_ENV: 'production',
        APP_URL: 'http://news.example.com',
        BETTER_AUTH_SECRET: 'a'.repeat(32),
        ALLOWED_GITHUB_USER_IDS: '1',
      }),
    ).toThrow('HTTPS');
  });
});

describe('public invitation deployment', () => {
  const production = {
    APP_MODE: 'live',
    NODE_ENV: 'production',
    APP_URL: 'https://news.example.test',
    DATABASE_URL: `postgresql://news:${'a'.repeat(64)}@db:5432/news`,
    BETTER_AUTH_SECRET: 'test-only-strong-configuration-secret-123456789',
    GITHUB_CLIENT_ID: 'fixture-client',
    GITHUB_CLIENT_SECRET: 'fixture-secret',
    ALLOWED_GITHUB_USER_IDS: '123,456',
  };
  it('accepts explicit production settings and blocks server-local files', () => {
    expect(localSkillsEnabled(getConfig(production))).toBe(false);
    expect(localSkillsEnabled(getConfig({ APP_MODE: 'demo' }))).toBe(true);
    expect(localSkillsEnabled(getConfig({ LOCAL_SKILLS_ENABLED: 'false' }))).toBe(false);
  });
  it.each(['docker', 'native'])('keeps public deployment restrictions in %s mode', (runtime) => {
    for (const change of [
      { GITHUB_READ_TOKEN: 'shared-test-token' },
      { LOCAL_SKILLS_ENABLED: 'true' },
      { ALLOWED_GITHUB_USER_IDS: '*' },
      { ALLOWED_GITHUB_USER_IDS: '123,' },
      { APP_URL: 'https://news.example.test/path' },
      { APP_URL: 'https://news.example.test/?token=x' },
      { GITHUB_CLIENT_SECRET: '' },
      { DATABASE_URL: 'postgresql://news:news_local_only@db/news' },
    ])
      expect(() => getConfig({ ...production, DATABASE_RUNTIME: runtime, ...change })).toThrow();
  });
});
